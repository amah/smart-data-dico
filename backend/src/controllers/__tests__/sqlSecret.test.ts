/**
 * Connect-flow wiring for password persistence (#209): `remember` saves the
 * password to the secret store, a later connect with a blank password reuses it,
 * and the forget endpoint clears it. The DB layer is mocked (no real database);
 * the secret store is real, forced to the AES-GCM provider over a temp file.
 */
jest.mock('../../services/sql/sqlRunService.js', () => ({
  sqlRunService: { connect: jest.fn(async () => ({ dialect: 'postgres', connection: { host: 'h' }, user: 'app' })) },
  NoConnectionError: class extends Error {},
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { sqlConnect, sqlSecretCapabilities, sqlSecretStatus, sqlForgetSecret } from '../sqlController.js';
import { sqlRunService } from '../../services/sql/sqlRunService.js';
import { resetSecretProvider } from '../../services/sql/secretStore.js';

const connectMock = sqlRunService.connect as jest.MockedFunction<any>;

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const body = (over: Record<string, unknown> = {}) => ({
  body: { packageName: 'orders', dialect: 'postgres', connection: { host: 'h' }, user: 'app', ...over },
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-secret-ctl-'));
  process.env.DICO_SECRETS_FILE = path.join(dir, 'secrets.json');
  process.env.DICO_SECRET_PROVIDER = 'aesgcm';
  process.env.DICO_SECRET_KEY = 'master-key-for-tests';
  resetSecretProvider();
  connectMock.mockClear();
});
afterEach(() => {
  delete process.env.DICO_SECRETS_FILE;
  delete process.env.DICO_SECRET_PROVIDER;
  delete process.env.DICO_SECRET_KEY;
  resetSecretProvider();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('capabilities reflects the active provider', async () => {
  const res = mockRes();
  await sqlSecretCapabilities({} as any, res);
  expect(res.json).toHaveBeenCalledWith({ data: { canStore: true, provider: 'aesgcm' } });
});

it('remember=true persists the password; a later blank-password connect reuses it', async () => {
  // 1. connect with a password + remember
  const res1 = mockRes();
  await sqlConnect(body({ password: 's3cr3t', remember: true }) as any, res1);
  expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ remembered: true, usedSaved: false }));
  expect(connectMock.mock.calls[0][1].credentials.password).toBe('s3cr3t');

  // 2. status now reports a saved secret
  const resS = mockRes();
  await sqlSecretStatus(body() as any, resS);
  expect(resS.json).toHaveBeenCalledWith({ data: { hasSecret: true } });

  // 3. connect again with NO password → reuses the saved one
  const res2 = mockRes();
  await sqlConnect(body({ password: '' }) as any, res2);
  expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ usedSaved: true }));
  expect(connectMock.mock.calls[1][1].credentials.password).toBe('s3cr3t');
});

it('without remember, nothing is persisted', async () => {
  const res = mockRes();
  await sqlConnect(body({ password: 's3cr3t' }) as any, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ remembered: false }));

  const resS = mockRes();
  await sqlSecretStatus(body() as any, resS);
  expect(resS.json).toHaveBeenCalledWith({ data: { hasSecret: false } });
});

it('a blank-password connect with no saved secret is rejected (400)', async () => {
  const res = mockRes();
  await sqlConnect(body({ password: '' }) as any, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(connectMock).not.toHaveBeenCalled();
});

it('forget clears the saved password', async () => {
  await sqlConnect(body({ password: 's3cr3t', remember: true }) as any, mockRes());
  await sqlForgetSecret({ params: { packageName: 'orders' } } as any, mockRes());

  const resS = mockRes();
  await sqlSecretStatus(body() as any, resS);
  expect(resS.json).toHaveBeenCalledWith({ data: { hasSecret: false } });
});

it('remember is a no-op for sqlite (no password to store)', async () => {
  const res = mockRes();
  await sqlConnect({ body: { packageName: 'orders', dialect: 'sqlite', connection: { file: '/tmp/x.db' }, remember: true } } as any, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ remembered: false }));
});
