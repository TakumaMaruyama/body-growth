export type DatabaseEnvironment = {
  NODE_ENV?: string;
  DATABASE_SSL_CA?: string;
};

export function databaseSslConfig(
  environment: DatabaseEnvironment = process.env,
): true | { ca: string; rejectUnauthorized: true } | undefined {
  if (environment.NODE_ENV !== "production") return undefined;

  const certificateAuthority = environment.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  return certificateAuthority
    ? { ca: certificateAuthority, rejectUnauthorized: true }
    : true;
}