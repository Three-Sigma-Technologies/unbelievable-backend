"use strict";

const { sanitizeEntity } = require("strapi-utils/lib");
const objectCleaner = require("../../../utils/objectCleaner");

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

  async getSideMenuItems(ctx) {
    let allTopics = sanitizeEntity(
      await strapi.query("blog-topics").find({ _limit: -1 }),
      { model: strapi.models["blog-topics"] }
    );

    allTopics = allTopics.map((topic) =>
      objectCleaner(["blogPosts", "id"], topic)
    );

    let popularBlogPosts = sanitizeEntity(
      await strapi.query("blog-posts").find({ _sort: "views:desc", _limit: 3 }),
      { model: strapi.models["blog-posts"] }
    );

    popularBlogPosts = popularBlogPosts.map((topic) =>
      objectCleaner(
        [
          "id",
          "blogAuthor",
          "blogTopics",
          "published_at",
          "bookmarked_by",
          "content",
          "views",
          "readTime",
        ],
        topic
      )
    );

    let recommendedBlogPosts = [];

    //Expects `currentTopics` from URL params (request from FE)
    let topicIdsArr = ctx.query.currentTopics.split(",");

    if (ctx.state.user) {
      const user = await strapi
        .query("user", "users-permissions")
        .findOne({ id: ctx.state.user.id });
      let usersViewedTopics = user.viewedTopics.slice(0, 3);

      //If topics from user are not empty (emptiness is possible due to new account / never read blog before)
      //Then substitute topicIdsArr with those topics
      if (allTopics.length)
        topicIdsArr = usersViewedTopics.map(
          (topic) => topic.blog_topic.topicId
        );
    }

    if (ctx.query.currentTopics || topicIdsArr.length) {
      //Querying all `currentTopics` and getting all of the blog posts
      recommendedBlogPosts = sanitizeEntity(
        await Promise.all(
          await topicIdsArr.map(async (topicId) => {
            const blogTopic = await strapi
              .query("blog-topics")
              .findOne({ topicId: topicId.toLowerCase() });

            if (blogTopic) {
              const blogPostsWithTopics = await Promise.all(
                blogTopic.blogPosts.map(async (post) => {
                  const blogPosts = await strapi
                    .query("blog-posts")
                    .findOne({ slug: post.slug.toLowerCase() });
                  return { ...post, blogTopics: blogPosts.blogTopics };
                })
              );

              return { blogTopic, blogPosts: blogPostsWithTopics };
            }
          })
        ),
        { model: strapi.models["blog-topics"] }
      )
        //   Filters out null values
        .filter((topicObj) => {
          return topicObj;
        })
        //Reduces the array of object of topics with blog posts into an array of objects of blog posts only
        .reduce((acc, topic) => [...acc, ...topic.blogPosts], [])
        //Sort by views (descending)
        .sort((a, b) => b.views - a.views)
        //Removes duplicated blog posts
        .filter(
          (blogPost, index, blogPostsArr) =>
            index === blogPostsArr.findIndex((bp) => bp.id === blogPost.id)
        )
        //Top 3 posts
        .slice(0, 3)
        //Remove unneeded properties
        .map((blogPost) => ({
          ...objectCleaner(
            [
              "id",
              "created_at",
              "published_at",
              "content",
              "blogAuthor",
              "readTime",
            ],
            blogPost
          ),
        }));
    }

    return {
      recommendedBlogPosts,
      popularBlogPosts,
      allTopics,
      isGuest: !ctx.state.user,
    };
  },
};