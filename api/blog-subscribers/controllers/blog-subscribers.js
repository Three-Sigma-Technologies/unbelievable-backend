"use strict";

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

module.exports = {
  async create(ctx) {
    const { email } = ctx.request.body;

    //If there's a user with that email
    //Link it to their profile

    const subscribed = await strapi.query("blog-subscribers").findOne({
      email,
    });

    //Ssecurity measure to prevent
    //enumeration attack.

    //Says "success" but
    //doesnt actually insert anything to DB
    if (subscribed) {
      return {
        email,
        message: "success",
      };
    }

    const user = await strapi.query("user", "users-permissions").findOne({
      email,
    });

    if (user) {
      await strapi
        .query("blog-subscribers")
        .create({ ...ctx.request.body, user: { id: user.id } });
    } else {
      await strapi
        .query("blog-subscribers")
        .create({ ...ctx.request.body, user: null });
    }

    return {
      email,
      message: "success",
    };
  },
};
