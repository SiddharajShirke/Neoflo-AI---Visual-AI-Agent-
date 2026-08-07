import { popupControls } from './view-model.js';

type Monitoring = { kind: string; consentActive?: boolean; errorCode?: string | null };
type Response = {
  auth?: { authenticated: boolean; email: string | null };
  monitoring?: Monitoring;
  domains?: string[];
  protectedCategories?: string[];
  error?: string;
};
const runtime = (
  globalThis as unknown as {
    chrome: { runtime: { sendMessage(message: object): Promise<Response> } };
  }
).chrome.runtime;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const signIn = document.querySelector<HTMLFormElement>('#sign-in')!;
const controls = document.querySelector<HTMLElement>('#controls')!;
const dashboard = document.querySelector<HTMLAnchorElement>('#dashboard')!;
const domainForm = document.querySelector<HTMLFormElement>('#domain-form')!;
const domainInput = document.querySelector<HTMLInputElement>('#excluded-domain')!;
const domainList = document.querySelector<HTMLUListElement>('#domain-list')!;
const protectedList = document.querySelector<HTMLUListElement>('#protected-categories')!;
dashboard.href = import.meta.env.VITE_DASHBOARD_URL ?? '#';

function updateControls(monitoring: Monitoring | undefined): void {
  const enabled = popupControls(monitoring);
  controls.querySelectorAll<HTMLButtonElement>('button[data-command]').forEach((button) => {
    button.disabled = !enabled[button.dataset.command as keyof typeof enabled];
  });
}

function renderDomains(response: Response): void {
  domainList.replaceChildren(
    ...(response.domains ?? []).map((domain) => {
      const item = document.createElement('li');
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.dataset.domain = domain;
      remove.dataset.command = 'remove_domain';
      item.append(domain, ' ', remove);
      return item;
    })
  );
  protectedList.replaceChildren(
    ...(response.protectedCategories ?? []).map((category) => {
      const item = document.createElement('li');
      item.textContent = category;
      return item;
    })
  );
}

async function send(message: object): Promise<void> {
  const response = await runtime.sendMessage(message);
  status.textContent =
    response.error ??
    response.monitoring?.kind ??
    (response.auth?.authenticated ? 'READY' : 'SIGNED_OUT');
  controls.hidden = !response.auth?.authenticated;
  signIn.hidden = Boolean(response.auth?.authenticated);
  updateControls(response.monitoring);
  renderDomains(response);
}

signIn.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.querySelector<HTMLInputElement>('#email')!.value;
  const passwordInput = document.querySelector<HTMLInputElement>('#password')!;
  const password = passwordInput.value;
  try {
    await send({ type: 'sign_in', email, password });
  } finally {
    passwordInput.value = '';
  }
});
domainForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await send({ type: 'add_domain', domain: domainInput.value });
  domainInput.value = '';
});
controls.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const command = target.dataset.command;
  if (command) await send({ type: command, domain: target.dataset.domain });
});
void send({ type: 'status' });
