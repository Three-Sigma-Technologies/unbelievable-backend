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
      if (Object.keys(data).length > 1) {
        data.readTime = getReadingTime(data.content);
        data.blogTopicsText = await getBlogTopicsText(data);
      }
    },

    async beforeCreate(data) {
      data.readTime = getReadingTime(data.content);
      data.blogTopicsText = await getBlogTopicsText(data);
    },
  },
};
