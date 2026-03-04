import * as Joi from 'joi';
import { parsePortRange } from './utils/parse-port';

const hostOrIpSchema = () =>
  Joi.alternatives().try(
    Joi.string().ip({ version: ['ipv4', 'ipv6'] }),
    Joi.string().hostname(),
    Joi.string().valid('localhost'),
  );

export const validationSchema = Joi.object({
  DOMAIN: Joi.string().trim().min(1).default('localhost'),
  HTTP_PORT: Joi.number().port().default(3000),
  SSH_PORT: Joi.number().port().default(2222),
  SSH_HOST: hostOrIpSchema().default('0.0.0.0'),
  SSH_HOST_KEY_PATH: Joi.string().trim().min(1).default('./test.key'),
  SSH_AUTH_MODE: Joi.string().valid('noauth', 'password').default('noauth'),
  SSH_AUTH_USERNAME: Joi.string().trim().min(1),
  SSH_AUTH_PASSWORD: Joi.when('SSH_AUTH_MODE', {
    is: 'password',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().min(1),
  }),
  TUNNEL_PORT_RANGE: Joi.string()
    .pattern(/^\d+\s*-\s*\d+$/)
    .custom((value: string, helpers) => {
      if (!parsePortRange(value)) return helpers.error('string.pattern.base');
      return value;
    })
    .messages({
      'string.pattern.base': 'TUNNEL_PORT_RANGE must match "min-max" format',
    }),
}).unknown(true);
