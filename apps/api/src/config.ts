import Joi from 'joi';
import { parsePortRange } from './utils/parse-port';

const hostOrIpSchema = () =>
  Joi.alternatives().try(
    Joi.string().ip({ version: ['ipv4', 'ipv6'] }),
    Joi.string().hostname(),
    Joi.string().valid('localhost'),
  );

export const validationSchema = Joi.object<Config>({
  DOMAIN: Joi.string().trim().min(1).default('localhost'),
  FORWARD_TARGET_HOST: hostOrIpSchema().default('127.0.0.1'),
  HTTP_PORT: Joi.number().port().default(3000),
  SSH_PORT: Joi.number().port().default(2222),
  SSH_HOST: hostOrIpSchema().default('0.0.0.0'),
  SSH_HOST_KEY_PATH: Joi.string().trim().min(1).default('./host.key'),
  SSH_AUTH_MODE: Joi.string().valid('noauth', 'password').default('noauth'),
  SSH_AUTH_USERNAME: Joi.string().trim().min(1),
  SSH_AUTH_PASSWORD: Joi.when('SSH_AUTH_MODE', {
    is: 'password',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().min(1),
  }),
  TUNNEL_PORT_RANGE: Joi.string()
    .required()
    .pattern(/^\d+\s*-\s*\d+$/)
    .custom((value: string, helpers) => {
      if (!parsePortRange(value)) return helpers.error('string.pattern.base');
      return value;
    })
    .messages({
      'string.pattern.base': 'TUNNEL_PORT_RANGE must match "min-max" format',
    }),
}).unknown(true);

export interface Config {
  DOMAIN: string;
  FORWARD_TARGET_HOST: string;
  HTTP_PORT: number;
  SSH_PORT: number;
  SSH_HOST: string;
  SSH_HOST_KEY_PATH: string;
  SSH_AUTH_MODE: 'noauth' | 'password';
  SSH_AUTH_USERNAME?: string;
  SSH_AUTH_PASSWORD?: string;
  TUNNEL_PORT_RANGE: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = validationSchema.validate(env, {
    abortEarly: false,
  });
  if (result.error)
    throw new Error(`Invalid configuration: ${result.error.message}`);
  return result.value;
}
