"use strict";
const readingTime = require("reading-time");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#lifecycle-hooks)
 * to customize this model
 */

//Returns in minute(s)
const getReadingTime = (text) =>
  Math.round(readingTime(text).minutes).toString();

module.exports = {
  lifecycles: {
    async afterUpdate(data) {
      data.readTime = getReadingTime(data.content);
    },
    async afterCreate(data) {
      data.readTime = getReadingTime(data.content);
    },
  },
};
