"use strict";
const { v4: uuidv4 } = require("uuid");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#lifecycle-hooks)
 * to customize this model
 */

module.exports = {
  lifecycles: {
    async afterCreate(data) {
      const course_uuid = uuidv4();
      await strapi.services.courses.update(
        { id: data.id },
        {
          uuid: course_uuid,
        }
      );

      await strapi.services.announcement.create({
        pengumuman: [],
        course_name: data.title,
        course: data.id,
      });

      await strapi.services.price.create({
        price: "5000",
        course_name: data.title,
        course: data.id,
      });

      await strapi.services["grouped-videos"].create({
        course_name: data.title,
        course: data.id,
      });
    },
  },
};
