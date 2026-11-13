import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createApi } from './server/api.mjs'

// https://vite.dev/config/
export default defineConfig(({mode}) => {
  // Only explicitly selected public settings are returned by /api/config.
  // Server keys are never prefixed with VITE_ or injected into the client bundle.
  const env={...loadEnv(mode,process.cwd(),''),...process.env}
  return {
    plugins:[react(),{name:'casafast-api',configureServer(server){server.middlewares.use(createApi(undefined,{env}))},configurePreviewServer(server){server.middlewares.use(createApi(undefined,{env}))}}],
    server:{host:'127.0.0.1',fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/server/**']}},
  }
})
