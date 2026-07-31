import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.log("ℹ️  Sentry DSN not set — error monitoring disabled");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2,
    beforeSend(event) {
      // Strip sensitive data
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });

  console.log("✅ Sentry error monitoring initialized");
}

export { Sentry };
