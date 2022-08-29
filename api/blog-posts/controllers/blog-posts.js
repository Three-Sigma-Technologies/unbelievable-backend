"use strict";

const { sanitizeEntity } = require("strapi-utils/lib");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

const cleanupUserViewedTopics = (userViewedTopics) => {
  return userViewedTopics.map((topic) => ({
    views: topic.views,
    blog_topic: topic.blog_topic.id,
  }));
};

module.exports = {
  async findOne(ctx) {
    const result = await strapi
      .query("blog-posts")
      .findOne({ slug: ctx.params.slug });

    if (!result) return ctx.notFound();

    const newViews = result.views + 1;

    await strapi
      .query("blog-posts")
      .update({ slug: ctx.params.slug }, { views: newViews });

    if (ctx.state.user && result.blogTopics.length) {
      const user = await strapi.query("user", "users-permissions").findOne({
        id: ctx.state.user.id,
      });

      const modifiedUserViewedTopics = result.blogTopics.map((topic) => {
        const index = [...user.viewedTopics].findIndex((userViewedTopic) => {
          return userViewedTopic.blog_topic.id === topic.id;
        });
        if (index < 0) {
          return { blog_topic: topic.id, views: 1, name: topic.topicName };
        } else {
          const topicObj = {
            blog_topic: topic.id,
            views: user.viewedTopics[index].views + 1,
            name: topic.topicName,
          };
          user.viewedTopics.splice(index, 1);
          return topicObj;
        }
      });

      await strapi.query("user", "users-permissions").update(
        { id: ctx.state.user.id },
        {
          viewedTopics: [
            ...cleanupUserViewedTopics(user.viewedTopics),
            ...modifiedUserViewedTopics,
          ].sort((a, b) => b.views - a.views),
        }
      );
    }
    return sanitizeEntity(
      { ...result, views: newViews },
      {
        model: strapi.models["blog-posts"],
      }
    );
  },
};
