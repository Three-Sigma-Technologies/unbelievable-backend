"use strict";

const { sanitizeEntity } = require("strapi-utils/lib");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

module.exports = {
  async findOne(ctx) {
    const result = await strapi
      .query("blog-posts")
      .findOne({ slug: ctx.params.slug });

    const newViews = result.views + 1;

    await strapi
      .query("blog-posts")
      .update({ slug: ctx.params.slug }, { views: newViews });

    return sanitizeEntity(
      { ...result, views: newViews },
      {
        model: strapi.models["blog-posts"],
      }
    );
  },
};
