export const RATE_LIMIT_POLICY = {
  LOGIN: { max: 8, seconds: 900 },
  PASSWORD_CHANGE: { max: 8, seconds: 900 },
  MEASUREMENT_UPDATE: { max: 30, seconds: 300 },
  REGISTER: { max: 5, seconds: 3600 },
} as const;