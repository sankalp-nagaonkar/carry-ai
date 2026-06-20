import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import 'dotenv/config';

export function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

export function loadConfig({ rootDir = process.cwd(), profession = 'doctor' } = {}) {
  const appConfigPath = path.join(rootDir, 'config', 'app.yml');
  const professionConfigPath = path.join(rootDir, 'config', 'professions', `${profession}.yml`);
  const app = readYaml(appConfigPath);
  const prof = readYaml(professionConfigPath);
  validateConfig(app, prof, rootDir);
  return { app, profession: prof, rootDir };
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing required env var: ${name}`);
}

export function envByName(name) {
  return process.env[name];
}

export function validateConfig(app, prof, rootDir = process.cwd()) {
  if (!app?.llm?.base_url) throw new Error('Missing app.llm.base_url');
  if (!app?.llm?.default_model) throw new Error('Missing app.llm.default_model');
  if (!prof?.profession) throw new Error('Missing profession name');

  requireEnv('FASTROUTER_API_KEY');

  if (app.scalekit?.enabled) {
    requireEnv(app.scalekit.client_id_env || 'SCALEKIT_CLIENT_ID');
    requireEnv(app.scalekit.client_secret_env || 'SCALEKIT_CLIENT_SECRET');
    const envUrlName = app.scalekit.environment_url_env || 'SCALEKIT_ENVIRONMENT_URL';
    if (!process.env[envUrlName] && !process.env.SCALEKIT_ENV_URL) {
      throw new Error(`Missing required env var: ${envUrlName} or SCALEKIT_ENV_URL`);
    }
  }

  for (const promptPath of Object.values(prof.prompts || {})) {
    const full = path.join(rootDir, promptPath);
    if (!fs.existsSync(full)) throw new Error(`Missing prompt file: ${promptPath}`);
  }

  for (const [toolName, tool] of Object.entries(app.tools || {})) {
    if (tool.enabled && tool.connection_name_env && !process.env[tool.connection_name_env]) {
      throw new Error(`Tool ${toolName} enabled but env var ${tool.connection_name_env} is missing`);
    }
  }
}

export function resolveLlmConfig(config) {
  const app = config.app.llm;
  const prof = config.profession.llm || {};
  return {
    provider: app.provider,
    baseUrl: app.base_url,
    model: prof.model || app.default_model,
    temperature: prof.temperature ?? app.temperature ?? 0.1,
    maxTokens: prof.max_tokens ?? app.max_tokens ?? 4000,
  };
}

export function readPrompt(config, promptKey) {
  const rel = config.profession.prompts?.[promptKey];
  if (!rel) throw new Error(`Missing prompt key: ${promptKey}`);
  return fs.readFileSync(path.join(config.rootDir, rel), 'utf8');
}
