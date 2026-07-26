-- Initial Stage 1 Auth/RBAC/Projects baseline.
-- Source: reviewed fresh Prisma diff from empty; see docs/STAGE1_BASELINE_SQL_PROPOSAL.sql.
-- STAGE 1 BASELINE SQL PROPOSAL вЂ” NOT A MIGRATION
-- Generated from packages/database/prisma/schema.prisma with Prisma 7.9.0.
-- Reviewed at Stage 0; do not apply without the separate initial-migration approval.
-- Reproduce with: pnpm db:diff:check (invariants) and Prisma migrate diff from empty.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'REUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenFamilyId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "replacedBySessionId" TEXT,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "reuseDetectedAt" TIMESTAMPTZ(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "global_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_roles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_role_permissions" (
    "globalRoleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "global_role_permissions_pkey" PRIMARY KEY ("globalRoleId","permissionId")
);

-- CreateTable
CREATE TABLE "project_role_permissions" (
    "projectId" TEXT NOT NULL,
    "projectRoleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "project_role_permissions_pkey" PRIMARY KEY ("projectId","projectRoleId","permissionId")
);

-- CreateTable
CREATE TABLE "global_user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "globalRoleId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memberships" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectRoleId" TEXT NOT NULL,
    "createdById" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_user_invite_tokens" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "globalRoleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "invitedByEmailSnapshot" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_user_invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_active_invite_reservations" (
    "normalizedEmail" TEXT NOT NULL,
    "globalRoleId" TEXT NOT NULL,
    "inviteTokenId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_active_invite_reservations_pkey" PRIMARY KEY ("normalizedEmail","globalRoleId")
);

-- CreateTable
CREATE TABLE "project_user_invite_tokens" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectRoleId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "invitedByEmailSnapshot" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_user_invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_active_invite_reservations" (
    "projectId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "inviteTokenId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_active_invite_reservations_pkey" PRIMARY KEY ("projectId","normalizedEmail")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "projectNameSnapshot" TEXT,
    "projectSlugSnapshot" TEXT,
    "actorUserId" TEXT,
    "actorEmailSnapshot" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeSafeJson" JSONB,
    "afterSafeJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_normalizedEmail_key" ON "users"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_status_idx" ON "sessions"("userId", "status");

-- CreateIndex
CREATE INDEX "sessions_tokenFamilyId_status_idx" ON "sessions"("tokenFamilyId", "status");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_id_userId_tokenFamilyId_key" ON "sessions"("id", "userId", "tokenFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_replacedBySessionId_userId_tokenFamilyId_key" ON "sessions"("replacedBySessionId", "userId", "tokenFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_expiresAt_idx" ON "password_reset_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "global_roles_normalizedName_key" ON "global_roles"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "project_roles_projectId_id_key" ON "project_roles"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_roles_projectId_normalizedName_key" ON "project_roles"("projectId", "normalizedName");

-- CreateIndex
CREATE INDEX "global_role_permissions_permissionId_idx" ON "global_role_permissions"("permissionId");

-- CreateIndex
CREATE INDEX "project_role_permissions_permissionId_idx" ON "project_role_permissions"("permissionId");

-- CreateIndex
CREATE INDEX "global_user_roles_globalRoleId_idx" ON "global_user_roles"("globalRoleId");

-- CreateIndex
CREATE INDEX "global_user_roles_createdById_idx" ON "global_user_roles"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "global_user_roles_userId_globalRoleId_key" ON "global_user_roles"("userId", "globalRoleId");

-- CreateIndex
CREATE INDEX "project_memberships_projectId_projectRoleId_idx" ON "project_memberships"("projectId", "projectRoleId");

-- CreateIndex
CREATE INDEX "project_memberships_userId_status_idx" ON "project_memberships"("userId", "status");

-- CreateIndex
CREATE INDEX "project_memberships_createdById_idx" ON "project_memberships"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_projectId_id_key" ON "project_memberships"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_projectId_userId_key" ON "project_memberships"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "global_user_invite_tokens_tokenHash_key" ON "global_user_invite_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "global_user_invite_tokens_normalizedEmail_expiresAt_idx" ON "global_user_invite_tokens"("normalizedEmail", "expiresAt");

-- CreateIndex
CREATE INDEX "global_user_invite_tokens_globalRoleId_idx" ON "global_user_invite_tokens"("globalRoleId");

-- CreateIndex
CREATE INDEX "global_user_invite_tokens_invitedById_idx" ON "global_user_invite_tokens"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "global_user_invite_tokens_id_globalRoleId_key" ON "global_user_invite_tokens"("id", "globalRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "global_active_invite_reservations_inviteTokenId_key" ON "global_active_invite_reservations"("inviteTokenId");

-- CreateIndex
CREATE INDEX "global_active_invite_reservations_globalRoleId_idx" ON "global_active_invite_reservations"("globalRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "global_active_invite_reservations_inviteTokenId_globalRoleI_key" ON "global_active_invite_reservations"("inviteTokenId", "globalRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "project_user_invite_tokens_tokenHash_key" ON "project_user_invite_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "project_user_invite_tokens_projectId_normalizedEmail_expire_idx" ON "project_user_invite_tokens"("projectId", "normalizedEmail", "expiresAt");

-- CreateIndex
CREATE INDEX "project_user_invite_tokens_projectId_projectRoleId_idx" ON "project_user_invite_tokens"("projectId", "projectRoleId");

-- CreateIndex
CREATE INDEX "project_user_invite_tokens_invitedById_idx" ON "project_user_invite_tokens"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "project_user_invite_tokens_projectId_id_key" ON "project_user_invite_tokens"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_active_invite_reservations_inviteTokenId_key" ON "project_active_invite_reservations"("inviteTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "project_active_invite_reservations_projectId_inviteTokenId_key" ON "project_active_invite_reservations"("projectId", "inviteTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_status_createdAt_idx" ON "projects"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_projectId_createdAt_idx" ON "audit_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_correlationId_idx" ON "audit_logs"("correlationId");

-- CreateIndex
CREATE INDEX "audit_logs_purgeAfter_idx" ON "audit_logs"("purgeAfter");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replacedBySessionId_userId_tokenFamilyId_fkey" FOREIGN KEY ("replacedBySessionId", "userId", "tokenFamilyId") REFERENCES "sessions"("id", "userId", "tokenFamilyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_role_permissions" ADD CONSTRAINT "global_role_permissions_globalRoleId_fkey" FOREIGN KEY ("globalRoleId") REFERENCES "global_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_role_permissions" ADD CONSTRAINT "global_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_role_permissions" ADD CONSTRAINT "project_role_permissions_projectId_projectRoleId_fkey" FOREIGN KEY ("projectId", "projectRoleId") REFERENCES "project_roles"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_role_permissions" ADD CONSTRAINT "project_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_user_roles" ADD CONSTRAINT "global_user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_user_roles" ADD CONSTRAINT "global_user_roles_globalRoleId_fkey" FOREIGN KEY ("globalRoleId") REFERENCES "global_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_user_roles" ADD CONSTRAINT "global_user_roles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_projectId_projectRoleId_fkey" FOREIGN KEY ("projectId", "projectRoleId") REFERENCES "project_roles"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_user_invite_tokens" ADD CONSTRAINT "global_user_invite_tokens_globalRoleId_fkey" FOREIGN KEY ("globalRoleId") REFERENCES "global_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_user_invite_tokens" ADD CONSTRAINT "global_user_invite_tokens_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_active_invite_reservations" ADD CONSTRAINT "global_active_invite_reservations_globalRoleId_fkey" FOREIGN KEY ("globalRoleId") REFERENCES "global_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_active_invite_reservations" ADD CONSTRAINT "global_active_invite_reservations_inviteTokenId_globalRole_fkey" FOREIGN KEY ("inviteTokenId", "globalRoleId") REFERENCES "global_user_invite_tokens"("id", "globalRoleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_user_invite_tokens" ADD CONSTRAINT "project_user_invite_tokens_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_user_invite_tokens" ADD CONSTRAINT "project_user_invite_tokens_projectId_projectRoleId_fkey" FOREIGN KEY ("projectId", "projectRoleId") REFERENCES "project_roles"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_user_invite_tokens" ADD CONSTRAINT "project_user_invite_tokens_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_active_invite_reservations" ADD CONSTRAINT "project_active_invite_reservations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_active_invite_reservations" ADD CONSTRAINT "project_active_invite_reservations_projectId_inviteTokenId_fkey" FOREIGN KEY ("projectId", "inviteTokenId") REFERENCES "project_user_invite_tokens"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
