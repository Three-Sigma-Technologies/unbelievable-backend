"use strict";
const readingTime = require("reading-time");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#lifecycle-hooks)
 * to customize this model
 */

//Returns in minute(s)
const getReadingTime = (text) => Math.round(readingTime(text).minutes);
const getBlogTopicsText = async (data) => {
  const blogTopicsTextArr = await Promise.all(
    data.blogTopics.map(
      async (id) =>
        (
          await strapi.query("blog-topics").findOne({ id })
        ).topicName
    )
  );
  return blogTopicsTextArr.reduce((acc, curr, ix) => {
    if (ix === 0) {
      return acc.concat(curr);
    } else {
      return acc.concat(`, ${curr}`);
    }
  }, " ");
};
module.exports = {
  lifecycles: {
    async beforeUpdate(_, data) {
      console.log({ dataContent: data.content });
      if (Object.keys(data).length > 1 && data.content) {
        data.readTime = getReadingTime(data.content);
        data.blogTopicsText = await getBlogTopicsText(data);
      }
    },

    async beforeCreate(data) {
      const currentDate = new Date();
      const moYear = `${
        currentDate.getUTCMonth() + 1
      }-${currentDate.getUTCFullYear()}`;

      const nextDate = new Date(
        currentDate.setMonth(currentDate.getUTCMonth() + 1)
      ); // current month + 1
      const nextMoYear = `${
        nextDate.getUTCMonth() + 1
      }-${nextDate.getUTCFullYear()}`;

      data.readTime = getReadingTime(data.content);
      data.blogTopicsText = await getBlogTopicsText(data);
      data.monthlyViews = { [moYear]: 0, [nextMoYear]: 0 };
    },
  },
};
