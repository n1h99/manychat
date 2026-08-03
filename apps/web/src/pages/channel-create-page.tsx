import {
  ApiOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  LockOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Form,
  Input,
  Segmented,
  Space,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { ApiError, getUserErrorMessage } from '../api';
import { type ChannelType, useChannelMutations, useWhatsAppSetup } from '../channels-api';
import {
  launchWhatsAppEmbeddedSignup,
  preloadWhatsAppEmbeddedSignup,
} from '../whatsapp-embedded-signup';

type CreateFormValues = {
  accessToken?: string;
  botToken?: string;
  businessAccountId?: string;
  graphApiVersion?: string;
  name: string;
  phoneNumberId?: string;
  twoStepPin?: string;
};

function cleanOptional(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function ChannelCreatePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<CreateFormValues>();
  const mutations = useChannelMutations(projectId);
  const [embeddedSignupPending, setEmbeddedSignupPending] = useState(false);
  const [embeddedSdkReady, setEmbeddedSdkReady] = useState(false);
  const [embeddedSdkError, setEmbeddedSdkError] = useState<string>();
  const [embeddedSdkAttempt, setEmbeddedSdkAttempt] = useState(0);
  const provider: ChannelType =
    searchParams.get('type')?.toLowerCase() === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM';
  const providerName = provider === 'WHATSAPP' ? 'WhatsApp' : 'Telegram';
  const whatsappSetup = useWhatsAppSetup(projectId, provider === 'WHATSAPP');
  const embeddedSignupReady = Boolean(
    whatsappSetup.data?.configured &&
    whatsappSetup.data.appId &&
    whatsappSetup.data.configurationId &&
    whatsappSetup.data.graphApiVersion,
  );

  useEffect(() => {
    if (!embeddedSignupReady || !whatsappSetup.data?.appId || !whatsappSetup.data.graphApiVersion) {
      setEmbeddedSdkReady(false);
      setEmbeddedSdkError(undefined);
      return;
    }
    let active = true;
    setEmbeddedSdkError(undefined);
    void preloadWhatsAppEmbeddedSignup({
      appId: whatsappSetup.data.appId,
      graphApiVersion: whatsappSetup.data.graphApiVersion,
    })
      .then(() => {
        if (active) setEmbeddedSdkReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEmbeddedSdkReady(false);
        setEmbeddedSdkError(
          error instanceof Error ? error.message : 'Meta setup could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, [
    embeddedSignupReady,
    embeddedSdkAttempt,
    whatsappSetup.data?.appId,
    whatsappSetup.data?.graphApiVersion,
  ]);

  const chooseProvider = (next: ChannelType) => {
    form.resetFields();
    setSearchParams({ type: next.toLowerCase() });
  };

  const startEmbeddedSignup = async () => {
    if (
      !whatsappSetup.data?.appId ||
      !whatsappSetup.data.configurationId ||
      !whatsappSetup.data.graphApiVersion
    ) {
      void message.warning('Meta Embedded Signup is not configured yet.');
      return;
    }
    try {
      const { name } = await form.validateFields(['name']);
      const pin = form.getFieldValue('twoStepPin')?.trim();
      if (!pin || !/^\d{6}$/.test(pin)) {
        form.setFields([
          {
            errors: ['Enter the 6-digit PIN that will protect this WhatsApp number'],
            name: 'twoStepPin',
          },
        ]);
        return;
      }
      form.setFields([{ errors: [], name: 'twoStepPin' }]);
      setEmbeddedSignupPending(true);
      const result = await launchWhatsAppEmbeddedSignup({
        appId: whatsappSetup.data.appId,
        configurationId: whatsappSetup.data.configurationId,
        graphApiVersion: whatsappSetup.data.graphApiVersion,
      });
      const channel = await mutations.completeWhatsAppSetup.mutateAsync({
        code: result.code,
        name: name.trim(),
        pin,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
      });
      void message.success('WhatsApp Business connected.');
      void navigate(`/projects/${projectId}/channels/${channel.id}`);
    } catch (error) {
      const fallback =
        error instanceof Error && !(error instanceof ApiError) && !(error instanceof TypeError)
          ? error.message
          : 'WhatsApp setup could not be completed.';
      void message.error(getUserErrorMessage(error, fallback));
    } finally {
      form.setFieldValue('twoStepPin', '');
      mutations.completeWhatsAppSetup.reset();
      setEmbeddedSignupPending(false);
    }
  };

  return (
    <section className="narrow-page channel-create-page">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Connect a channel</Typography.Title>
          <Typography.Text type="secondary">
            Choose a provider and follow its secure setup flow.
          </Typography.Text>
        </div>
      </div>

      <Segmented<ChannelType>
        block
        className="channel-provider-switch"
        disabled={embeddedSignupPending || mutations.completeWhatsAppSetup.isPending}
        onChange={chooseProvider}
        options={[
          { icon: <ApiOutlined />, label: 'Telegram', value: 'TELEGRAM' },
          { icon: <MessageOutlined />, label: 'WhatsApp', value: 'WHATSAPP' },
        ]}
        value={provider}
      />

      <Card className="channel-create-card">
        {provider === 'TELEGRAM' ? (
          <Alert
            className="channel-soft-notice"
            description="After saving, the full token is encrypted and never displayed again. You will connect the webhook on the next screen."
            message="Get the bot token from BotFather"
            showIcon
            type="info"
          />
        ) : (
          <>
            <div className="whatsapp-setup-intro">
              <div className="channel-provider-mark channel-provider-mark--whatsapp">
                <MessageOutlined />
              </div>
              <div>
                <Typography.Title level={3}>WhatsApp Business setup</Typography.Title>
                <Typography.Paragraph type="secondary">
                  Omnicus connects through the official Meta WhatsApp Cloud API. A personal WhatsApp
                  account or an unofficial QR-code session cannot be used here.
                </Typography.Paragraph>
              </div>
            </div>

            <div className="whatsapp-setup-steps" aria-label="WhatsApp setup requirements">
              <div className="whatsapp-setup-step">
                <span>1</span>
                <div>
                  <strong>Prepare the Omnicus Meta app</strong>
                  <small>
                    The platform owner adds WhatsApp and enables the official signup configuration.
                  </small>
                </div>
              </div>
              <div className="whatsapp-setup-step">
                <span>2</span>
                <div>
                  <strong>Prepare the business number</strong>
                  <small>Copy its Business Account ID and Phone Number ID from Meta.</small>
                </div>
              </div>
              <div className="whatsapp-setup-step">
                <span>3</span>
                <div>
                  <strong>Connect the webhook</strong>
                  <small>Omnicus validates the account before activating the channel.</small>
                </div>
              </div>
            </div>

            <Alert
              className="channel-soft-notice"
              description={
                whatsappSetup.data?.configured
                  ? 'The official Meta signup configuration is available. Continue with Meta to select the business and number, or use the manual credentials section when you already manage them.'
                  : 'You can create the channel as a draft now. One-click Embedded Signup will be enabled only after an approved Meta app and its public signup configuration are available; Omnicus will not simulate that flow.'
              }
              message={
                whatsappSetup.data?.configured
                  ? 'Meta app configuration is ready'
                  : 'Meta configuration is not required to prepare the draft'
              }
              showIcon
              type="info"
            />
            {whatsappSetup.isError ? (
              <Alert
                className="form-alert"
                message={getUserErrorMessage(
                  whatsappSetup.error,
                  'Meta setup availability could not be checked.',
                )}
                showIcon
                type="error"
              />
            ) : null}
          </>
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              const name = values.name.trim();
              const channel =
                provider === 'TELEGRAM'
                  ? await mutations.create.mutateAsync({
                      botToken: values.botToken!,
                      name,
                      type: 'TELEGRAM',
                    })
                  : await mutations.create.mutateAsync({
                      name,
                      type: 'WHATSAPP',
                      ...(cleanOptional(values.accessToken)
                        ? { accessToken: cleanOptional(values.accessToken)! }
                        : {}),
                      ...(cleanOptional(values.businessAccountId)
                        ? { businessAccountId: cleanOptional(values.businessAccountId)! }
                        : {}),
                      ...(cleanOptional(values.graphApiVersion)
                        ? { graphApiVersion: cleanOptional(values.graphApiVersion)! }
                        : {}),
                      ...(cleanOptional(values.phoneNumberId)
                        ? { phoneNumberId: cleanOptional(values.phoneNumberId)! }
                        : {}),
                    });
              form.resetFields();
              void message.success(`${providerName} channel created.`);
              void navigate(
                `/projects/${projectId}/channels/${channel.id}${
                  provider === 'WHATSAPP' ? '?setup=1' : ''
                }`,
              );
            } catch (error) {
              void message.error(
                getUserErrorMessage(error, `${providerName} connection could not be created.`),
              );
            } finally {
              mutations.create.reset();
            }
          }}
          requiredMark={false}
        >
          <Form.Item
            label="Connection name"
            name="name"
            rules={[{ message: 'Enter a name for this connection', required: true }, { max: 120 }]}
          >
            <Input
              autoComplete="off"
              placeholder={
                provider === 'WHATSAPP' ? 'Customer support number' : 'Customer support bot'
              }
            />
          </Form.Item>

          {provider === 'TELEGRAM' ? (
            <Form.Item
              extra="The token remains only in this form until it is submitted."
              label="Bot token"
              name="botToken"
              rules={[
                { message: 'Enter the token from BotFather', required: true },
                { message: 'The bot token is too short', min: 8 },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          ) : (
            <>
              <div className="whatsapp-onboarding-choice">
                <div>
                  <span className="whatsapp-choice-eyebrow">Recommended</span>
                  <Typography.Title level={4}>Continue with Meta</Typography.Title>
                  <Typography.Paragraph type="secondary">
                    Select the business and phone inside Meta's official setup window. Omnicus
                    receives only the short-lived authorization result and safe account IDs.
                  </Typography.Paragraph>
                </div>
                <Button
                  disabled={!embeddedSignupReady || !embeddedSdkReady}
                  icon={<MessageOutlined />}
                  loading={
                    embeddedSignupPending ||
                    mutations.completeWhatsAppSetup.isPending ||
                    (embeddedSignupReady && !embeddedSdkReady && !embeddedSdkError)
                  }
                  onClick={() => void startEmbeddedSignup()}
                  type="primary"
                >
                  Continue with Meta
                </Button>
                {embeddedSignupReady ? (
                  <Form.Item
                    className="whatsapp-pin-field"
                    extra="Used once to register and protect the business number. Omnicus never stores or displays it after submission."
                    label="6-digit two-step verification PIN"
                    name="twoStepPin"
                  >
                    <Input.Password
                      autoComplete="new-password"
                      inputMode="numeric"
                      maxLength={6}
                      pattern="[0-9]*"
                      placeholder="••••••"
                    />
                  </Form.Item>
                ) : null}
                {embeddedSdkError ? (
                  <Alert
                    action={
                      <Button
                        onClick={() => setEmbeddedSdkAttempt((attempt) => attempt + 1)}
                        size="small"
                      >
                        Retry
                      </Button>
                    }
                    className="form-alert"
                    description="No Meta authorization or account change has been submitted."
                    message={embeddedSdkError}
                    showIcon
                    type="error"
                  />
                ) : null}
                {!embeddedSignupReady ? (
                  <small>
                    Meta App ID and Embedded Signup configuration are not available yet. You can
                    still prepare a manual draft below.
                  </small>
                ) : null}
              </div>

              <Divider plain>or prepare the connection manually</Divider>

              <Collapse
                className="whatsapp-advanced-setup"
                items={[
                  {
                    children: (
                      <>
                        <Alert
                          className="channel-credential-notice"
                          description="Every secret is encrypted after saving and is never returned to the browser. IDs remain visible so you can verify the connected business and phone."
                          icon={<LockOutlined />}
                          message="Credentials stay server-side"
                          showIcon
                          type="success"
                        />
                        <div className="whatsapp-field-grid">
                          <Form.Item label="WhatsApp Business Account ID" name="businessAccountId">
                            <Input autoComplete="off" placeholder="Business account ID" />
                          </Form.Item>
                          <Form.Item label="Phone Number ID" name="phoneNumberId">
                            <Input autoComplete="off" placeholder="Phone number ID" />
                          </Form.Item>
                          <Form.Item
                            label="Graph API version"
                            name="graphApiVersion"
                            rules={[
                              {
                                message: "Use Meta's v<number>.<number> format",
                                pattern: /^v\d+\.\d+$/,
                              },
                            ]}
                          >
                            <Input
                              autoComplete="off"
                              placeholder="Use the version configured by Meta"
                            />
                          </Form.Item>
                          <Form.Item
                            label="Permanent access token"
                            name="accessToken"
                            rules={[{ message: 'The Meta access token is too short', min: 16 }]}
                          >
                            <Input.Password autoComplete="new-password" />
                          </Form.Item>
                        </div>
                        <Typography.Paragraph className="whatsapp-callback-note" type="secondary">
                          The Meta app secret and webhook verification token are server settings and
                          are never entered in the browser.
                          {whatsappSetup.data?.callbackUrl
                            ? ` Callback path: ${whatsappSetup.data.callbackUrl}`
                            : ''}
                        </Typography.Paragraph>
                      </>
                    ),
                    key: 'manual-setup',
                    label: (
                      <span className="whatsapp-advanced-label">
                        <SafetyCertificateOutlined /> I already have Meta credentials
                      </span>
                    ),
                  },
                ]}
              />
            </>
          )}

          <Space className="channel-create-footer" wrap>
            <Button
              disabled={embeddedSignupPending || mutations.completeWhatsAppSetup.isPending}
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(`/projects/${projectId}/channels`)}
            >
              Cancel
            </Button>
            <Button
              disabled={embeddedSignupPending || mutations.completeWhatsAppSetup.isPending}
              htmlType="submit"
              icon={provider === 'WHATSAPP' ? <CheckCircleOutlined /> : <SendOutlined />}
              loading={mutations.create.isPending}
              type="primary"
            >
              {provider === 'WHATSAPP' ? 'Create WhatsApp draft' : 'Create connection'}
            </Button>
          </Space>
        </Form>
      </Card>
    </section>
  );
}
