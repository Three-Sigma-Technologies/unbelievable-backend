module.exports = ({ env }) => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),
  cron: {
    enabled: true,
  },
  admin: {
    auth: {
      secret: env("ADMIN_JWT_SECRET", "65fda87206fa61f7fbc1bab02decc647"),
    },
  },
});
