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

const getRecommendedBlogPosts = async (
  sanitizeEntity,
  currentPostId,
  topicIdsArr = []
) => {
  let blogPosts = [];

  for (const topicId of topicIdsArr) {
    if (blogPosts.length === 3) {
      break;
    } else {
      const result = sanitizeEntity(
        await strapi
          .query("blog-topics")
          .findOne({ topicId }, [
            "blogPosts.blogTopics",
            "blogPosts.thumbnail",
          ]),
        { model: strapi.models["blog-topics"] }
      )
        // remove current blogpost
        .blogPosts.filter(
          (blogPost) => parseInt(blogPost.id) !== parseInt(currentPostId)
        )
        //sort by views (big to small)
        .sort((a, b) => {
          return b.views - a.views;
        })
        .slice(0, 3);

      blogPosts = [...blogPosts, ...result];
    }
  }

  return (
    [...blogPosts]
      //Removes duplicated blog posts
      .filter(
        (blogPost, index, blogPostsArr) =>
          index === blogPostsArr.findIndex((bp) => bp.id === blogPost.id)
      )
      .slice(0, 3)
  );
};

//Fn below is to search through blog posts, but for searching ?bookmarked_by.id=userId
//only allow if userId is ctx.state.user (user has logged in and user is userId)
const freeSearchBlogPosts = async (ctx) => {
  let entities;
  const { user } = ctx.state;
  if (ctx.query._q) {
    entities = await strapi.services["blog-posts"].search({
      ...ctx.query,
      _limit: -1,
    });
  } else {
    if ("bookmarked_by.id" in ctx.query || "_bookmarked_by.id" in ctx.query) {
      const searchedUserId = ctx.query["bookmarked_by.id"]
        ? ctx.query["bookmarked_by.id"]
        : ctx.query["_bookmarked_by.id"];
      if (!user) {
        console.log("No user found");
        return null;
      }
      if (parseInt(searchedUserId) !== parseInt(user.id)) {
        console.log("User is not searching its own resource");
        return null;
      }

      entities = await strapi.services["blog-posts"].find({
        ...ctx.query,
        _limit: -1,
      });
    } else {
      entities = await strapi.services["blog-posts"].find({
        ...ctx.query,
        _limit: -1,
      });
    }
  }
  return entities;
};

module.exports = {
  async find(ctx) {
    const entities = await freeSearchBlogPosts(ctx);
    if (!entities) return ctx.forbidden();
    const sanitisedBlogPosts = sanitizeEntity(entities, {
      model: strapi.models["blog-posts"],
    });
    return sanitisedBlogPosts.map((blogPost) =>
      objectCleaner(["bookmarked_by"], blogPost)
    );
  },

  async findOne(ctx) {
    const result = await strapi
      .query("blog-posts")
      .findOne({ slug: ctx.params.slug });

    if (!result) return ctx.notFound();

    const newViews = result.views + 1;

    const date = new Date();
    const monthYear = `${parseInt(
      date.getUTCMonth() + 1
    )}-${date.getUTCFullYear()}`;

    let newMonthlyViews = result.monthlyViews
      ? { ...result.monthlyViews }
      : { [monthYear]: 1 };

    //This should never be null
    if (result.monthlyViews) {
      if (monthYear in newMonthlyViews) {
        newMonthlyViews[monthYear] = parseInt(newMonthlyViews[monthYear] + 1);

        //This else stmt should never be executed
        //As [monthYear] will always be there because of CRON job
        //And lifecycle (for new blogposts)
      } else {
        newMonthlyViews[monthYear] = 1;
      }
    }

    await strapi
      .query("blog-posts")
      .update(
        { slug: ctx.params.slug },
        { views: newViews, monthlyViews: newMonthlyViews }
      );

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
  async bookmarkBlog(ctx) {
    const { id } = ctx.state.user;
    // const { uuid } = ctx.params;
    const { slug } = ctx.request.body;
    const blogPosts = await strapi.query("blog-posts").find({ slug });
    if (blogPosts.length === 1) {
      await strapi
        .query("blog-posts")
        .update(
          { slug },
          { bookmarked_by: [...blogPosts[0].bookmarked_by, { id }] }
        );
      return {
        status: "bookmarked",
      };
    } else {
      return ctx.notFound();
    }
  },

  async getSideMenuItems(ctx) {
    // if (!ctx.query.currentPostId) return ctx.notFound();

    let allTopics = sanitizeEntity(
      await strapi
        .query("blog-topics")
        .find({ _limit: -1, _sort: "topicName:asc" }),
      { model: strapi.models["blog-topics"] }
    );

    allTopics = allTopics.map((topic) =>
      objectCleaner(["blogPosts", "id"], topic)
    );

    let popularBlogPosts = sanitizeEntity(
      await strapi.query("blog-posts").find({ _sort: "views:desc", _limit: 5 }),
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
    let currentPostId = ctx.query.currentPostId
      ? ctx.query.currentPostId
      : null;

    if (ctx.state.user) {
      const user = await strapi
        .query("user", "users-permissions")
        .findOne({ id: ctx.state.user.id });

      //If topics from user are not empty (emptiness is possible due to new account / never read blog before)
      //Then substitute topicIdsArr with those topics
      if (user.viewedTopics.length) {
        let usersViewedTopics = user.viewedTopics.slice(0, 3);
        topicIdsArr = usersViewedTopics.map(
          (topic) => topic.blog_topic.topicId
        );
      }
    }

    if (
      (ctx.query.currentTopics && ctx.query.currentTopics.length) ||
      ctx.state.user
    ) {
      //Querying all `currentTopics` and getting all of the blog posts
      recommendedBlogPosts = await getRecommendedBlogPosts(
        sanitizeEntity,
        currentPostId,
        topicIdsArr
      );
    }

    return {
      recommendedBlogPosts,
      popularBlogPosts,
      allTopics,
      isGuest: !ctx.state.user,
    };
  },

  async getTrendingBlogPosts(ctx) {
    const currentDate = new Date();
    const currentMoYear = `${
      currentDate.getUTCMonth() + 1
    }-${currentDate.getUTCFullYear()}`;

    const entities = await freeSearchBlogPosts(ctx);
    if (!entities) return ctx.forbidden();

    return sanitizeEntity(entities, {
      model: strapi.models["blog-posts"],
    }).sort(
      (a, b) => b.monthlyViews[currentMoYear] - a.monthlyViews[currentMoYear]
    );
  },

  // async blogPostsByTopic(ctx) {

  //   return;
  // },
};
