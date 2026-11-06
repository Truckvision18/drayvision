import React, { createContext, useContext } from 'react';
import { api as defaultApi, type DrayVisionApi } from './client';

const Ctx = createContext<DrayVisionApi>(defaultApi);

/** The API client screens use — the real one by default, a fake in tests. */
export const ApiProvider = ({ api, children }: { api: DrayVisionApi; children: React.ReactNode }) => <Ctx.Provider value={api}>{children}</Ctx.Provider>;
export const useApi = (): DrayVisionApi => useContext(Ctx);
