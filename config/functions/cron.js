"use strict";

/**
 * Cron config that gives you an opportunity
 * to run scheduled jobs.
 *
 * The cron format consists of:
 * [SECOND (optional)] [MINUTE] [HOUR] [DAY OF MONTH] [MONTH OF YEAR] [DAY OF WEEK]
 *
 * See more details here: https://strapi.io/documentation/developer-docs/latest/setup-deployment-guides/configurations.html#cron-tasks
 */

module.exports = {
  /**
   * Simple example.
   * Every monday at 1am.
   */
  // '0 1 * * 1': () => {
  //
  // }

  //Every 20th date at 00:00
  //https://crontab.guru/#0_0_20_*_*
  "0 0 20 * *": async () => {
    const allBlogPosts = await strapi.query("blog-posts").find({ _limit: -1 });

    allBlogPosts.forEach(async (blogPost) => {
      const currDate = new Date();

      const nextDate = new Date(currDate.setMonth(currDate.getUTCMonth() + 1)); // current month + 1

      const nextMoYear = `${
        nextDate.getUTCMonth() + 1
      }-${nextDate.getUTCFullYear()}`;

      const futureMonthlyViews = {
        [nextMoYear]: 0,
      };

      await strapi.query("blog-posts").update(
        { id: blogPost.id },
        {
          shortDesc: `Current Date: ${Date.now()}`,
          monthlyViews: { ...blogPost.monthlyViews, ...futureMonthlyViews },
        }
      );
    });
  },
};
