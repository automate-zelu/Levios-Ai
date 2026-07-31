# Levios-Ai

Multi-tenant AI SDR platform for Leviosai CRM (custom calling stack + Stripe billing).

## App

Application code lives in [`Leviosai/`](./Leviosai).

```bash
cd Leviosai
npm install
npm run client:install
npm run dev
```

## CI / Deploy

GitHub Actions: `.github/workflows/main.yaml`  
Required secrets: `EC2_HOST`, `EC2_USER`, `EC2_KEY` (optional `EC2_DEPLOY_DIR`).
