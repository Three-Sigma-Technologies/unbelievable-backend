"use strict";
const fetch = require("node-fetch");

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

  //Every 23rd date of the month at 00:00
  //https://crontab.guru/#0_0_23_*_*
  "0 0 23 * *": async () => {
    const allBlogPosts = await strapi.query("blog-posts").find({ _limit: -1 });

    //For each blog posts
    //Append/add property of [nextMoYear]: 0 in monthlyViews obj

    //nextMoYear is next month of whatever is current month
    //If current month is Dec 2022, nextMoYear will be Jan 2023; format: (01-2023)
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
          monthlyViews: { ...blogPost.monthlyViews, ...futureMonthlyViews },
        }
      );
    });
  },
  //Every 28th date of the month at 00:00
  //https://crontab.guru/#0_0_28_*_*
  "*/10 * * * *": async () => {
    const currentSocialEmbed = await strapi.query("social-embeds").findOne();
    const fetchIGToken = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentSocialEmbed.ig_access_token.token}`
    );

    console.log("=====FETCHING IG TOKEN====");
    console.log(fetchIGToken);
    console.log("=========");

    if (fetchIGToken.ok) {
      const tokenResponse = await fetchIGToken.json();
      console.log("FETCHING SUCCESS", tokenResponse.access_token);

      await strapi.query("social-embeds").update(
        { id: 1 },
        {
          ig_access_token: {
            id: 1,
            token: tokenResponse.access_token,
            renewed_at: new Date(),
          },
        }
      );
    } else {
      console.log("[ERROR] Re-fetching new IG token:", new Date());
      Promise.reject(fetchIGToken);
    }
  },
};
