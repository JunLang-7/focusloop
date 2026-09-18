/**
 * The contract every other package shares.
 *
 * The domain's states, the event vocabulary, the shape of the IPC surface and the message keys live
 * here, so a change to the shape of the system is a compile error in the package that has to handle
 * it. Types, constants and closed lists only — no behaviour.
 */

export * from './state';
export * from './events';
export * from './session';
export * from './material';
export * from './course';
export * from './checkpoint';
export * from './resume';
export * from './intervention';
export * from './dashboard';
export * from './insights';
export * from './provider';
export * from './ipc';
export * from './bridge';
export * from './messages';
export * from './settings';
