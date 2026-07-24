# OMNICUS — Prisma model proposal

## Статус

Executable baseline находится в
`packages/database/prisma/schema.prisma` на Prisma 7.9.0. На Этапе 0 он должен
проходить `prisma validate` и SQL diff review, но не является migration и не
применяется к БД.

Initial migration будет stage-sliced. Первый baseline, который разрешено
предложить на Этапе 1, содержит только Auth/RBAC/Projects и необходимый audit.
Contacts, channels, inbox/outbox, automation, CRM и остальные модели ниже
остаются design proposal до соответствующего этапа и не входят в executable
schema. Поэтому первая migration не создаёт около 40 преждевременных таблиц.

## Главные правила

1. PostgreSQL является источником истины.
2. Все tenant-owned models содержат обязательный `projectId`.
3. Каждая строго tenant-owned model объявляет `@@unique([projectId, id])`.
   Dual-scope `AuditLog` использует глобально уникальный primary key и не
   создаёт misleading nullable composite unique.
4. Tenant relation использует composite foreign key
   `fields: [projectId, entityId], references: [projectId, id]`.
5. Cross-project references проверяются PostgreSQL constraints и application
   project guard.
6. Provider identifiers хранятся как `String`, даже если текущий API возвращает
   число.
7. Event, audit, lifecycle и expiry timestamps используют PostgreSQL
   `TIMESTAMPTZ(3)` и хранятся в UTC.
8. Raw webhook body хранится как `Bytes`, чтобы сохранить точные валидные bytes
   и пережить JSON parse errors; parsed payload, safe request/response и mappings
   используют `Json`.
9. Secret plaintext и refresh token plaintext не хранятся.
10. Partial indexes/check constraints, которые нельзя надёжно выразить в
    текущей Prisma schema, сначала фиксируются в reviewed SQL proposal, затем
    добавляются в migration соответствующего этапа.
11. Global и project RBAC не разделяют nullable scope columns: для каждого
    boundary используются отдельные таблицы.
12. Hard delete Project запрещён при наличии tenant-owned role, membership,
    invite либо audit history: все прямые Stage 1 project foreign keys
    используют `RESTRICT`. Audit хранит immutable project name/slug snapshots.

## Stage-sliced migration map

| Slice            | Executable models                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage 1 baseline | `User`, `Session`, `PasswordResetToken`, global/project invites, `Permission`, global/project roles and assignments, `Project`, `AuditLog` |
| Stage 2          | contacts, tags, custom field definitions and values                                                                                        |
| Stage 3          | channel connections, webhook records, inbox/outbox, idempotency and messages                                                               |
| Stage 4          | scenarios and execution journal                                                                                                            |
| Stage 5          | project-specific CRM configuration after the CRM contract gate                                                                             |
| Post-pilot       | broadcasts, Wait, Delay, Subflow and advanced media workflows                                                                              |

Каждый slice получает отдельный generated SQL review. Ни одна будущая модель не
добавляется в Stage 1 baseline «про запас».

## Enum proposal

```prisma
enum UserStatus {
  ACTIVE
  DISABLED
}

enum TokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  REUSED
  EXPIRED
}

enum ProjectStatus {
  DRAFT
  ACTIVE
  PAUSED
  ARCHIVED
}

enum AutomationMode {
  AUTOMATION_ENABLED
  AUTOMATION_PAUSED
  MANUAL_MODE
}

enum ChannelType {
  TELEGRAM
  WHATSAPP
  INSTAGRAM
}

enum ChannelConnectionStatus {
  DRAFT
  CONNECTING
  CONNECTED
  ERROR
  DISABLED
}

enum ConsentStatus {
  UNKNOWN
  OPTED_IN
  OPTED_OUT
}

enum InboxStatus {
  RECEIVED
  PROCESSING
  PROCESSED
  RETRY_WAIT
  DEFERRED
  FAILED
  DEAD_LETTER
  IGNORED
}

enum SideEffectStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  UNKNOWN
}

enum ScenarioStatus {
  DRAFT
  PUBLISHED
  PAUSED
  ARCHIVED
}

enum ScenarioVersionStatus {
  DRAFT
  PUBLISHED
  SUPERSEDED
}

enum ScenarioExecutionStatus {
  QUEUED
  RUNNING
  WAITING
  PAUSED
  COMPLETED
  FAILED
  CANCELLED
}

enum MessageStatus {
  RECEIVED
  PENDING
  PROCESSING
  SUBMITTED
  SENT
  DELIVERED
  READ
  FAILED
  UNKNOWN
  CANCELLED
}

enum MediaAssetStatus {
  PROVIDER_REFERENCE
  PENDING_DOWNLOAD
  PENDING_UPLOAD
  AVAILABLE
  REJECTED
  UNAVAILABLE
  DELETED
}
```

Broadcast enums остаются только в future design proposal и не входят в
executable schema или pilot.

## Auth и RBAC — executable Stage 1 proposal

Executable proposal использует отдельные физические boundaries:

| Global boundary         | Project boundary                    |
| ----------------------- | ----------------------------------- |
| `GlobalRole`            | `ProjectRole(projectId)`            |
| `GlobalRolePermission`  | `ProjectRolePermission(projectId)`  |
| `GlobalUserRole`        | `ProjectMembership(projectId)`      |
| `GlobalUserInviteToken` | `ProjectUserInviteToken(projectId)` |

Инварианты:

- nullable `projectId` и nullable composite foreign keys в RBAC отсутствуют;
- `GlobalRolePermission` всегда ссылается на существующий `GlobalRole`;
- project permission, membership и invite ссылаются на role по
  `(projectId, projectRoleId)`, поэтому cross-project assignment невозможен;
- project invite имеет обязательный `projectId`; удаление role использует
  `RESTRICT`, а не `SET NULL`, поэтому invite не превращается в orphan и не
  теряет tenant boundary;
- удаление Project не каскадирует role, membership, invite или audit history;
  lifecycle использует archive/state transition, а hard delete требует
  отдельной контролируемой процедуры;
- role assignment unique для `(userId, globalRoleId)` либо
  `(projectId, userId)`;
- invitation token hash уникален глобально; email хранится как display snapshot
  и отдельный `normalizedEmail`;
- session rotation ссылается на replacement по
  `(replacedBySessionId, userId, tokenFamilyId)`, поэтому replacement из другой
  user/token family невозможен; nullable `replacedBySessionId` означает только
  отсутствие следующей rotation, а не orphan reference;
- hard delete User с существующей session family использует `RESTRICT`, чтобы
  cascade не конфликтовал с self-relation и не уничтожал security evidence;
- inviter может быть удалён через `SET NULL`, но immutable email snapshot
  сохраняется для audit;
- все FK, участвующие в delete/restrict/set-null checks, имеют supporting index;
- все lifecycle timestamps используют `TIMESTAMPTZ(3)`;
- active-invite partial uniqueness уже входит в generated Stage 1 SQL proposal:
  одна active invitation на `(normalizedEmail, globalRoleId)` и одна на
  `(projectId, normalizedEmail)`, где `acceptedAt IS NULL AND revokedAt IS NULL`;
  фактическая migration всё ещё не создана и требует отдельного approval.

Полная Prisma-форма этих моделей является единственным executable источником в
`packages/database/prisma/schema.prisma`.

### Отклонённая nullable-scope модель

Следующий первоначальный фрагмент сохранён только как контекст review и не
является executable proposal:

```prisma
model User {
  id           String     @id @default(uuid())
  email        String     @unique
  passwordHash String
  firstName    String
  lastName     String
  status       UserStatus @default(ACTIVE)
  lastLoginAt  DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}

model Session {
  id                  String      @id @default(uuid())
  userId              String
  tokenFamilyId       String
  refreshTokenHash    String      @unique
  csrfTokenHash       String
  status              TokenStatus @default(ACTIVE)
  replacedBySessionId String?
  issuedAt            DateTime    @default(now())
  expiresAt           DateTime
  rotatedAt           DateTime?
  revokedAt           DateTime?
  reuseDetectedAt     DateTime?
  ip                   String?
  userAgent            String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([tokenFamilyId, status])
  @@index([expiresAt])
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  ip        String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
}

model UserInviteToken {
  id            String   @id @default(uuid())
  projectId     String?
  email         String
  roleId        String?
  tokenHash     String   @unique
  invitedById   String
  expiresAt     DateTime
  acceptedAt    DateTime?
  revokedAt     DateTime?
  createdAt     DateTime @default(now())

  @@unique([projectId, id])
  @@index([projectId, email])
  @@index([expiresAt])
}

model Role {
  id          String   @id @default(uuid())
  projectId   String?
  name        String
  scope       String   // GLOBAL | PROJECT; DB CHECK
  system      Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([projectId, id])
  @@index([projectId, scope])
}

model Permission {
  id          String @id @default(uuid())
  code        String @unique
  description String
}

model RolePermission {
  projectId    String?
  roleId       String
  permissionId String

  @@id([roleId, permissionId])
  @@unique([projectId, roleId, permissionId])
}

model GlobalUserRole {
  id        String   @id @default(uuid())
  userId    String
  roleId    String
  createdBy String
  createdAt DateTime @default(now())

  @@unique([userId, roleId])
}

model ProjectMembership {
  id        String   @id @default(uuid())
  projectId String
  userId    String
  roleId    String
  status    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  role    Role    @relation(fields: [projectId, roleId], references: [projectId, id])

  @@unique([projectId, id])
  @@unique([projectId, userId])
  @@index([userId, status])
}
```

Этот вариант отклонён: migration-level CHECK не компенсирует nullable composite
foreign key. System project roles создаются отдельно для каждого project;
скрытая cross-tenant ссылка на общую mutable role запрещена.

## Project и CRM project configuration

```prisma
model Project {
  id          String        @id @default(uuid())
  name        String
  slug        String        @unique
  description String?
  status      ProjectStatus @default(DRAFT)
  timezone    String
  locale      String
  settings    Json
  version     Int           @default(1)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([status, createdAt])
}

model CrmProjectConfig {
  id                   String   @id @default(uuid())
  projectId            String   @unique
  crmProjectId         String
  fieldMapping         Json
  defaultPipeline      String?
  defaultStage         String?
  additionalParameters Json
  status               String
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, id])
  @@unique([projectId, crmProjectId])
}
```

`Project.crmProjectId` удаляется: единственный источник project-specific CRM
настроек — `CrmProjectConfig`. `CRM_BASE_URL` и `CRM_AUTH_TOKEN` остаются только
в environment.

## Contacts, fields, tags и consent

```prisma
model Contact {
  id                 String         @id @default(uuid())
  projectId          String
  firstName          String?
  lastName           String?
  displayName        String?
  phone              String?
  email              String?
  status             String
  automationMode     AutomationMode @default(AUTOMATION_ENABLED)
  crmLeadId          String?
  crmContactId       String?
  crmManagerId       String?
  firstInteractionAt DateTime?
  lastInteractionAt  DateTime?
  mergedIntoContactId String?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  @@unique([projectId, id])
  @@index([projectId, status, lastInteractionAt])
  @@index([projectId, crmLeadId])
}

model CustomFieldDefinition {
  id          String   @id @default(uuid())
  projectId   String
  key         String
  name        String
  type        String
  config      Json
  required    Boolean  @default(false)
  archivedAt  DateTime?
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, key])
}

model ContactCustomFieldValue {
  id             String   @id @default(uuid())
  projectId      String
  contactId      String
  definitionId   String
  valueJson      Json
  valueText      String?
  valueNumber    Decimal?
  valueBoolean   Boolean?
  valueDateTime  DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  contact    Contact               @relation(fields: [projectId, contactId], references: [projectId, id], onDelete: Cascade)
  definition CustomFieldDefinition @relation(fields: [projectId, definitionId], references: [projectId, id], onDelete: Restrict)

  @@unique([projectId, id])
  @@unique([projectId, contactId, definitionId])
  @@index([projectId, definitionId, valueText])
  @@index([projectId, definitionId, valueNumber])
  @@index([projectId, definitionId, valueDateTime])
}

model Segment {
  id           String   @id @default(uuid())
  projectId    String
  name         String
  filterSchemaVersion Int
  filter       Json
  status       String
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, name])
}

model Tag {
  id             String   @id @default(uuid())
  projectId      String
  name           String
  normalizedName String
  color          String?
  description    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, normalizedName])
}

model ContactTag {
  projectId String
  contactId String
  tagId     String
  source    String
  createdAt DateTime @default(now())

  contact Contact @relation(fields: [projectId, contactId], references: [projectId, id], onDelete: Cascade)
  tag     Tag     @relation(fields: [projectId, tagId], references: [projectId, id], onDelete: Cascade)

  @@id([projectId, contactId, tagId])
}
```

Typed projection columns позволяют фильтровать без небезопасного произвольного
JSON coercion. Runtime и DB CHECK должны гарантировать заполнение только
projection, соответствующей definition type.

## Channels, identities и conversations

```prisma
model ChannelConnection {
  id                    String                  @id @default(uuid())
  projectId             String
  channel               ChannelType
  name                  String
  status                ChannelConnectionStatus
  externalAccountId     String?
  credentialsEncrypted  Bytes
  credentialVersion     Int                     @default(1)
  settings              Json
  capabilities          Json
  lastWebhookAt         DateTime?
  lastErrorAt           DateTime?
  createdAt             DateTime                @default(now())
  updatedAt             DateTime                @updatedAt

  @@unique([projectId, id])
  @@index([projectId, channel, status])
}

model ChannelIdentity {
  id                     String      @id @default(uuid())
  projectId              String
  contactId              String
  connectionId           String
  channel                ChannelType
  externalUserId         String
  externalConversationId String?
  externalThreadId       String?
  username               String?
  phone                  String?
  displayName            String?
  metadata               Json
  blockedAt              DateTime?
  lastInboundAt          DateTime?
  lastOutboundAt         DateTime?
  createdAt              DateTime    @default(now())
  updatedAt              DateTime    @updatedAt

  contact    Contact           @relation(fields: [projectId, contactId], references: [projectId, id], onDelete: Cascade)
  connection ChannelConnection @relation(fields: [projectId, connectionId], references: [projectId, id], onDelete: Restrict)

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalUserId])
}

model ChannelConsent {
  id                String        @id @default(uuid())
  projectId         String
  channelIdentityId String
  purpose           String
  status            ConsentStatus
  source            String
  evidence          Json?
  effectiveAt       DateTime
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  identity ChannelIdentity @relation(fields: [projectId, channelIdentityId], references: [projectId, id], onDelete: Cascade)

  @@unique([projectId, id])
  @@unique([projectId, channelIdentityId, purpose])
}

model Conversation {
  id                     String          @id @default(uuid())
  projectId              String
  contactId              String
  channelIdentityId      String
  connectionId           String
  channel                ChannelType
  externalConversationId String
  externalThreadId       String?
  status                 String
  automationModeOverride AutomationMode?
  crmLeadId              String?
  nextSequence           BigInt          @default(1)
  lastInboundAt          DateTime?
  lastOutboundAt         DateTime?
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalConversationId, externalThreadId])
  @@index([projectId, contactId, updatedAt])
}
```

Effective automation mode:

```text
Conversation.automationModeOverride
?? Contact.automationMode
?? AUTOMATION_ENABLED
```

## Media

```prisma
model MediaAsset {
  id                 String           @id @default(uuid())
  projectId          String
  connectionId       String?
  source             String
  status             MediaAssetStatus
  providerMediaId    String?
  providerMetadata   Json?
  bucketKey          String?
  originalFilename   String?
  detectedMimeType   String?
  declaredMimeType   String?
  extension          String?
  sizeBytes          BigInt?
  checksumSha256     String?
  retentionUntil     DateTime?
  deletedAt          DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  @@unique([projectId, id])
  @@index([projectId, status, retentionUntil])
  @@index([projectId, connectionId, providerMediaId])
}
```

Signed URL не хранится: он генерируется на запрос с коротким TTL. Bucket credentials
не находятся в этой таблице.

## Inbox, raw events и idempotency

```prisma
model RawWebhookEvent {
  id               String      @id @default(uuid())
  projectId        String
  connectionId     String
  channel          ChannelType
  externalEventKey String
  safeHeaders      Json
  contentType      String?
  payloadRaw       Bytes
  payloadJson      Json?
  receivedAt       DateTime    @default(now())
  purgeAfter       DateTime

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalEventKey])
  @@index([projectId, receivedAt])
  @@index([purgeAfter])
}

model RejectedWebhookAttempt {
  id              String      @id @default(uuid())
  projectId       String
  connectionId    String
  channel         ChannelType
  sourceIp        String?
  safeHeaders     Json
  rejectionReason String
  correlationId   String
  receivedAt      DateTime    @default(now())

  @@unique([projectId, id])
  @@index([projectId, receivedAt])
}

model InboxRecord {
  id                String      @id @default(uuid())
  projectId         String
  rawWebhookEventId String?
  provider          ChannelType
  connectionId      String
  externalEventKey  String
  status            InboxStatus
  correlationId     String
  attempts          Int         @default(0)
  maxAttempts       Int
  attemptGroup      Int         @default(1)
  leaseOwner        String?
  leaseExpiresAt    DateTime?
  nextAttemptAt     DateTime?
  lastErrorSafe     Json?
  receivedAt        DateTime    @default(now())
  processedAt       DateTime?
  updatedAt         DateTime    @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalEventKey])
  @@index([status, nextAttemptAt])
  @@index([leaseExpiresAt])
  @@index([projectId, receivedAt])
}

model IdempotencyRecord {
  id              String           @id @default(uuid())
  projectId       String
  scope           String
  key             String
  requestHash     String
  status          SideEffectStatus
  resourceType    String?
  resourceId      String?
  responseSafe    Json?
  httpStatus      Int?
  expiresAt       DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, scope, key])
  @@index([expiresAt])
}

model OutboxRecord {
  id                 String           @id @default(uuid())
  projectId          String
  operationType      String
  aggregateType      String
  aggregateId        String
  idempotencyKey     String
  payload            Json
  status             SideEffectStatus @default(PENDING)
  correlationId      String
  attempts           Int              @default(0)
  maxAttempts        Int
  attemptGroup       Int              @default(1)
  leaseOwner         String?
  leaseExpiresAt     DateTime?
  nextAttemptAt      DateTime?
  externalReference  String?
  resultSafe         Json?
  lastErrorSafe      Json?
  failureClass       String?
  retryable          Boolean?
  unknownReason      String?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
  completedAt        DateTime?

  @@unique([projectId, id])
  @@unique([projectId, operationType, idempotencyKey])
  @@index([status, nextAttemptAt])
  @@index([leaseExpiresAt])
  @@index([projectId, aggregateType, aggregateId])
}
```

`RejectedWebhookAttempt` не содержит raw body. IP и headers проходят allowlist,
redaction и retention.

## Events и messages

```prisma
model NormalizedEvent {
  id                String      @id @default(uuid())
  projectId         String
  rawWebhookEventId String
  connectionId      String
  channel           ChannelType
  externalEventId   String
  eventType         String
  payload           Json
  occurredAt        DateTime
  createdAt         DateTime    @default(now())

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalEventId])
  @@index([projectId, occurredAt])
}

model Message {
  id                  String        @id @default(uuid())
  projectId           String
  conversationId      String
  contactId           String
  connectionId        String
  channel             ChannelType
  direction           String
  type                String
  text                String?
  content             Json?
  externalMessageId   String?
  status              MessageStatus
  source              String
  scenarioExecutionId String?
  broadcastId         String?
  idempotencyKey      String?
  errorSafe           Json?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, connectionId, direction, externalMessageId])
  @@index([projectId, conversationId, createdAt])
}

model MessageStatusEvent {
  id                String   @id @default(uuid())
  projectId         String
  messageId         String
  status            String
  externalStatusKey String
  externalTimestamp DateTime?
  errorCode         String?
  errorMessageSafe  String?
  rawWebhookEventId String?
  createdAt         DateTime @default(now())

  @@unique([projectId, id])
  @@unique([projectId, messageId, externalStatusKey])
}

model OrphanMessageStatus {
  id                String      @id @default(uuid())
  projectId         String
  connectionId      String
  externalMessageId String
  externalStatusKey String
  status            String
  normalizedPayload Json
  occurredAt        DateTime?
  resolutionStatus  String
  resolvedMessageId String?
  receivedAt        DateTime    @default(now())
  resolvedAt        DateTime?

  @@unique([projectId, id])
  @@unique([projectId, connectionId, externalMessageId, externalStatusKey])
  @@index([projectId, resolutionStatus, receivedAt])
}
```

Nullable `externalMessageId` требует review generated unique index: PostgreSQL
допускает несколько NULL, что желательно для ещё не отправленных messages.

## Scenarios и executions

```prisma
model Scenario {
  id              String         @id @default(uuid())
  projectId       String
  name            String
  description     String?
  status          ScenarioStatus
  activeVersionId String?
  draftVersionId  String?
  createdBy       String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@unique([projectId, id])
  @@index([projectId, status])
}

model ScenarioVersion {
  id                 String                @id @default(uuid())
  projectId          String
  scenarioId         String
  version            Int
  status             ScenarioVersionStatus
  graph              Json
  variablesSchema    Json
  compiledDefinition Json?
  validation         Json
  contentHash        String
  createdBy          String
  createdAt          DateTime              @default(now())
  publishedAt        DateTime?

  @@unique([projectId, id])
  @@unique([projectId, scenarioId, version])
  @@unique([projectId, scenarioId, contentHash])
}

model ScenarioExecution {
  id                String                  @id @default(uuid())
  projectId         String
  scenarioId        String
  scenarioVersionId String
  contactId         String
  conversationId    String
  triggerEventId    String
  triggerKey        String
  conversationSequence BigInt
  status            ScenarioExecutionStatus
  currentNodeId     String?
  variables         Json
  correlationId     String
  cancellationRequestedAt DateTime?
  startedAt         DateTime?
  waitingAt         DateTime?
  completedAt       DateTime?
  failedAt          DateTime?
  errorSafe         Json?
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt

  @@unique([projectId, id])
  @@unique([projectId, scenarioId, triggerKey])
  @@index([projectId, conversationId, conversationSequence])
  @@index([projectId, status, updatedAt])
}

model NodeExecution {
  id                  String           @id @default(uuid())
  projectId           String
  scenarioExecutionId String
  nodeId              String
  nodeType            String
  status              SideEffectStatus
  inputSafe           Json
  outputSafe          Json?
  attempt             Int
  attemptGroup        Int
  idempotencyKey      String
  startedAt           DateTime?
  completedAt         DateTime?
  errorSafe           Json?

  @@unique([projectId, id])
  @@unique([projectId, scenarioExecutionId, nodeId, attemptGroup])
  @@unique([projectId, idempotencyKey])
}

model WaitState {
  id                  String   @id @default(uuid())
  projectId           String
  scenarioExecutionId String
  scenarioId          String
  scenarioVersionId   String
  nodeId              String
  conversationId      String
  status              String
  criteria            Json
  expiresAt           DateTime
  resolvedByEventId   String?
  createdAt           DateTime @default(now())
  resolvedAt          DateTime?

  @@unique([projectId, id])
  @@index([projectId, conversationId, scenarioId, status])
}
```

При добавлении Stage 4 relations `activeVersionId`, `draftVersionId` и
`scenarioVersionId` обязаны ссылаться composite keys
`(projectId, scenarioId, versionId)`. Простая ссылка только по `versionId`
запрещена: она позволила бы Scenario или execution закрепить версию другого
scenario того же tenant. До появления этих constraints модели не входят в
executable schema.

Для одного active Wait на `(projectId, conversationId, scenarioId)` требуется
partial unique index `WHERE status = 'ACTIVE'`, добавляемый migration SQL.
Wait/Subflow не реализуются в pilot, но schema reserved для совместимости можно
добавить только на этапе их реализации.

## Broadcast future models

`Broadcast` и `BroadcastRecipient` сохраняются в design backlog. При реализации
каждая таблица получает `projectId`, а recipient uniqueness:

```text
UNIQUE(projectId, broadcastId, channelIdentityId)
```

Audience фиксируется snapshot recipients при `PREPARING`, а не вычисляется заново
во время отправки.

## Audit

```prisma
model AuditLog {
  id                  String   @id @default(uuid())
  projectId           String?
  projectNameSnapshot String?
  projectSlugSnapshot String?
  actorUserId         String?
  actorEmailSnapshot  String?
  actorType           String
  action              String
  entityType          String
  entityId            String?
  beforeSafeJson      Json?
  afterSafeJson       Json?
  ip                  String?
  userAgent           String?
  correlationId       String
  reason              String?
  createdAt           DateTime @default(now()) @db.Timestamptz(3)
  purgeAfter          DateTime @db.Timestamptz(3)
  project             Project? @relation(fields: [projectId], references: [id], onDelete: Restrict)
  actor               User?    @relation("AuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([projectId, createdAt])
  @@index([actorUserId, createdAt])
  @@index([correlationId])
  @@index([purgeAfter])
}
```

`projectId` nullable только для действительно global auth/security actions.
Project action всегда обязана иметь `projectId`,
`projectNameSnapshot` и `projectSlugSnapshot`. Relation использует
`ON DELETE RESTRICT`, а не `CASCADE`: проект нельзя hard-delete до завершения
audit retention/purge workflow. Actor может стать `NULL`, но
`actorEmailSnapshot` остаётся immutable.

## Migration review checklist

Перед первой migration:

- подтвердить, что generated SQL создаёт только Stage 1 slice;
- сверить committed SQL proposal с повторным `prisma migrate diff`;
- проверить отсутствие nullable RBAC composite foreign keys;
- проверить project role/invite/member FKs по `(projectId, projectRoleId)`;
- проверить `AuditLog.project ON DELETE RESTRICT` и immutable snapshots;
- проверить, что lifecycle timestamps сгенерированы как
  `TIMESTAMP(3) WITH TIME ZONE`;
- заменить string state/type fields на enums, если provider extensibility не
  требует string;
- проверить все generated foreign keys и `ON DELETE`;
- active Wait partial uniqueness добавить только в Stage 4 migration;
- добавить CHECK для Role scope и typed custom values;
- проверить nullable unique semantics;
- добавить index для outbox/inbox relay без full-table scan;
- проверить, что tenant relation использует `(projectId, id)`;
- проверить raw payload/audit purge indexes;
- проверить, что CRM URL/token отсутствуют в tables;
- выполнить `prisma format`, `prisma validate` и review SQL;
- миграцию не применять автоматически к production.
