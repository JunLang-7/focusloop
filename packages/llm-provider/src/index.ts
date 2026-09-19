/**
 * The provider adapter.
 *
 * Offline by default: the mock provider is a required part of the system, and the remote adapter is
 * only constructed when a key is supplied. The registry is what decides between them, so no caller
 * has to know whether a network is available.
 */

export * from './errors';
export * from './mock-provider';
export * from './deepseek-provider';
export * from './registry';
