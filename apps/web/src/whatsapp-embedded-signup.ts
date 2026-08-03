export type WhatsAppEmbeddedSignupResult = {
  code: string;
  phoneNumberId: string;
  wabaId: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init: (options: { appId: string; version: string; xfbml: boolean }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      override_default_response_type: boolean;
      response_type: 'code';
    },
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

const facebookOrigins = new Set(['https://www.facebook.com', 'https://web.facebook.com']);
const sdkId = 'omnicus-facebook-jssdk';
const signupTimeoutMs = 120_000;
let initializedSdkKey: string | undefined;
let sdkLoadPromise: Promise<FacebookSdk> | undefined;

function boundedValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  return normalized && normalized.length <= maxLength && !hasControlCharacter
    ? normalized
    : undefined;
}

function readFacebookSdk(): FacebookSdk | undefined {
  return window.FB;
}

function initializeFacebookSdk(sdk: FacebookSdk, appId: string, graphApiVersion: string) {
  const key = `${appId}:${graphApiVersion}`;
  if (initializedSdkKey === key) return;
  sdk.init({ appId, version: graphApiVersion, xfbml: false });
  initializedSdkKey = key;
}

export function parseWhatsAppEmbeddedSignupMessage(
  event: Pick<MessageEvent, 'data' | 'origin'>,
): { phoneNumberId: string; wabaId: string } | null {
  if (!facebookOrigins.has(event.origin)) return null;
  let payload: unknown = event.data;
  if (typeof payload === 'string') {
    if (payload.length > 16_384) return null;
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const message = payload as {
    data?: { phone_number_id?: unknown; waba_id?: unknown };
    event?: unknown;
    type?: unknown;
  };
  if (message.type !== 'WA_EMBEDDED_SIGNUP' || message.event !== 'FINISH') return null;
  const phoneNumberId = boundedValue(message.data?.phone_number_id, 128);
  const wabaId = boundedValue(message.data?.waba_id, 128);
  if (!phoneNumberId || !wabaId) return null;
  return {
    phoneNumberId,
    wabaId,
  };
}

async function loadFacebookSdk(appId: string, graphApiVersion: string): Promise<FacebookSdk> {
  const current = readFacebookSdk();
  if (current) {
    initializeFacebookSdk(current, appId, graphApiVersion);
    return current;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(sdkId) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener('load', ready);
      script.removeEventListener('error', failed);
    };
    const ready = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (readFacebookSdk()) resolve();
      else reject(new Error('Meta setup could not be loaded. Try again.'));
    };
    const failed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error('Meta setup could not be loaded. Check the network and try again.'));
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error('Meta setup took too long to load. Try again.'));
    }, 20_000);
    script.addEventListener('load', ready);
    script.addEventListener('error', failed);
    if (!existing) {
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.id = sdkId;
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.head.append(script);
    }
  });

  const loaded = readFacebookSdk();
  if (!loaded) throw new Error('Meta setup could not be loaded. Try again.');
  initializeFacebookSdk(loaded, appId, graphApiVersion);
  return loaded;
}

export async function preloadWhatsAppEmbeddedSignup(options: {
  appId: string;
  graphApiVersion: string;
}): Promise<void> {
  sdkLoadPromise ??= loadFacebookSdk(options.appId, options.graphApiVersion);
  try {
    await sdkLoadPromise;
  } catch (error) {
    sdkLoadPromise = undefined;
    throw error;
  }
}

function createEmbeddedSignupSessionWaiter() {
  let settled = false;
  let listener: ((event: MessageEvent) => void) | undefined;
  let timeout: number | undefined;
  const cleanup = () => {
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (listener) window.removeEventListener('message', listener);
    timeout = undefined;
    listener = undefined;
  };
  const promise = new Promise<{ phoneNumberId: string; wabaId: string }>((resolve, reject) => {
    listener = (event: MessageEvent) => {
      const result = parseWhatsAppEmbeddedSignupMessage(event);
      if (!result || settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Meta did not return the selected WhatsApp account. Try again.'));
    }, signupTimeoutMs);
    window.addEventListener('message', listener);
  });
  return {
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
    promise,
  };
}

export async function launchWhatsAppEmbeddedSignup(options: {
  appId: string;
  configurationId: string;
  graphApiVersion: string;
}): Promise<WhatsAppEmbeddedSignupResult> {
  const session = createEmbeddedSignupSessionWaiter();
  try {
    const facebook = readFacebookSdk();
    if (!facebook) {
      throw new Error('Meta setup is still loading. Wait a moment and try again.');
    }
    initializeFacebookSdk(facebook, options.appId, options.graphApiVersion);
    const code = new Promise<string>((resolve, reject) => {
      facebook.login(
        (response) => {
          const value = boundedValue(response.authResponse?.code, 2_048);
          if (value) resolve(value);
          else reject(new Error('Meta setup was cancelled before the account was connected.'));
        },
        {
          config_id: options.configurationId,
          override_default_response_type: true,
          response_type: 'code',
        },
      );
    });
    const [authorizationCode, account] = await Promise.all([code, session.promise]);
    return { code: authorizationCode, ...account };
  } finally {
    session.cancel();
  }
}
