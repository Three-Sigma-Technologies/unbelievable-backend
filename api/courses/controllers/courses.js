"use strict";
const { sanitizeEntity } = require("strapi-utils");
const fetch = require("node-fetch");
const client = require("@mailchimp/mailchimp_marketing");
const sgClient = require("@sendgrid/client");
const md5 = require("md5");
const courses = require("../models/courses");

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

const _MS_PER_DAY = 1000 * 60 * 60 * 24;

function dateDiffInDays(a, b) {
  const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((utc2 - utc1) / _MS_PER_DAY);
}

const percent = (percent, number) => {
  return parseFloat(number * (percent / 100));
};

const insertToSpecificIndex = (arr, index, newItem) => [
  // part of the array before the specified index
  ...arr.slice(0, index),
  // inserted item
  newItem,
  // part of the array after the specified index
  ...arr.slice(index),
];

const sendgridConfigSetup = () => {
  sgClient.setApiKey(process.env.SENDGRID_API_KEY);
};

const mailChimpConfigSetup = () => {
  client.setConfig({
    apiKey: process.env.MAILCHIMP_API,
    server: process.env.MAILCHIMP_SERVER_PREFIX,
  });
};

const toSendgrid = async (payer_email) => {
  const data = {
    list_ids: [process.env.SENDGRID_API_LIST_CONTACT],
    contacts: [
      {
        email: payer_email,
        custom_fields: {
          w2_T: "paid",
        },
      },
    ],
  };

  const request = {
    url: `/v3/marketing/contacts`,
    method: "PUT",
    body: data,
  };

  const response = await sgClient.request(request);

  return { status: "ok" };
};

const toMailchimp = async (payer_email) => {
  const subscriber_hash = md5(payer_email);
  console.log(subscriber_hash);
  const response = await client.lists.updateListMemberTags(
    process.env.MAILCHIMP_LIST_ID,
    subscriber_hash,
    {
      tags: [
        { name: "paid", status: "active" },
        { name: "free", status: "inactive" },
      ],
    }
  );
  return { status: "ok" };
};

module.exports = {
  async xenditCb(ctx) {
    if (
      ctx.request.header["x-callback-token"] !==
      process.env.XENDIT_CALLBACK_TOKEN
    ) {
      return "Not Found.";
    }
    //callback / hook -
    //will be called automatically
    //from xendit after user has paid

    //callback method below will check if external_id and payer_email are valid
    //and match each other.
    //Both data will be checked against
    //the saved data in the waiting-payment model

    //if they are valid (exist and matching) then course model will be updated
    //with new enrolled_users, paid_users, and paid_users_detail

    console.log("callback called");
    const { external_id, payer_email } = ctx.request.body;
    const pendingPayment = await strapi
      .query("waiting-payment")
      .find({ ex_id: `${external_id}` });
    if (pendingPayment.length > 0) {
      console.log("pending payment found");

      const { course } = pendingPayment[0];

      const user = await strapi.plugins[
        "users-permissions"
      ].services.user.fetch({
        id: pendingPayment[0].user.id,
      });

      const userEmailFromDb = user.email;

      // get this exact course via a standalone query
      // due to pendingPayment not returning enrolled_users[] and paid_users[]
      //but it does return paid_users_detail[]
      const exactCourse = await strapi.query("courses").find({ id: course.id });
      const { paid_users, enrolled_users, content_creator } = exactCourse[0];
      // conditional check just for good measure
      if (payer_email === userEmailFromDb) {
        console.log("payer email is user email");
        console.log("updating course");

        const updateCourse = await strapi.query("courses").update(
          { id: course.id },
          {
            paid_users_detail: [
              ...course.paid_users_detail,
              { date: new Date(), user },
            ],
            paid_users: [...paid_users, user],
            enrolled_users: [...enrolled_users, user],
          }
        );

        if (user.paid_courses.length === 0 || !user.paid_courses) {
          console.log("Updating MC n SG to be 'paid'");
          mailChimpConfigSetup();
          await toMailchimp(payer_email);
          sendgridConfigSetup();
          await toSendgrid(payer_email);
          console.log("user has been updated to 'paid' (MC,SG)");
        } else {
          console.log(
            "No need to update MC because it's already set as 'paid'"
          );
        }
        console.log("course updated");

        if (Object.keys(updateCourse).length > 0) {
          const del = await strapi
            .query("waiting-payment")
            .delete({ ex_id: external_id });
          if (del) {
            console.log("success deleting waiting payment");
            const net_price_arr = external_id.split("-");
            //above is = ["slug", "Date.now * 2", netPrice]
            let net_price = net_price_arr[net_price_arr.length - 1];
            let transactionData = {
              net_price,
              unb_price: 0,
              col_price: 0,
              course_name: course.title,
              content_creator_name: content_creator.full_name
                ? content_creator.full_name
                : "NO_NAME_FOUND",
              content_creator_type: content_creator.content_creator_type,
              user_email: payer_email,
              user_register_code: "",
              remark: "DEFAULT",
            };
            if (content_creator.content_creator_type === "UNBELIEVABLE") {
              transactionData = {
                ...transactionData,
                unb_price: net_price,
                col_price: 0,
                remark: "COLLABORATOR_IS_UNB",
              };
            } else {
              if (!user.register_link) {
                // if user registered without any special link
                transactionData = {
                  ...transactionData,
                  unb_price: net_price / 2,
                  col_price: net_price / 2,
                };
              } else {
                if (user.register_link.code_type === "AD") {
                  //AD
                  // 80 unb - 20 col
                  transactionData = {
                    ...transactionData,
                    unb_price: percent(80, net_price),
                    col_price: percent(20, net_price),
                    user_register_code: user.register_link.code,
                    remark: "AD",
                  };
                } else if (user.register_link.code_type === "COLLABORATOR") {
                  console.log(user.register_link);
                  if (
                    user.register_link.content_creator === content_creator.id
                  ) {
                    // MATCH
                    // 20 unb - 80 col
                    transactionData = {
                      ...transactionData,
                      unb_price: percent(20, net_price),
                      col_price: percent(80, net_price),
                      user_register_code: user.register_link.code,
                      remark: "REG_MATCH",
                    };
                  } else {
                    //NOT MATCH
                    //80 unb - 20 col
                    transactionData = {
                      ...transactionData,
                      unb_price: percent(80, net_price),
                      col_price: percent(20, net_price),
                      user_register_code: user.register_link.code,
                      remark: "REG_NOT_MATCH",
                    };
                  }
                }
              }
            }

            await strapi.query("transaction").create(transactionData);
            return {
              message: "ok",
            };
          } else {
            console.log("failed deleting waiting payment");
            return ctx.badRequest(null, {
              message: "Failed  deleting waiting payment",
            });
          }
        } else {
          console.log("Failed updating user and course upon payment");
          return ctx.badRequest(null, {
            message: "Failed updating user and course upon payment",
          });
        }
      } else {
        return ctx.badRequest(null, {
          message: "not found",
        });
      }
    } else {
      return ctx.badRequest(null, {
        message: "not found",
      });
    }
  },

  async xendit(ctx) {
    // this endpoint does:
    //1 . Call xendit API to create a new invoice_url
    //2. Create a new entry of waiting_payment with the corresponding: user, course, external_id, and invoice_url
    const { courseId } = ctx.request.body;

    let detailedCourse = await strapi
      .query("courses")
      .findOne({ id: courseId });

    if (!detailedCourse) {
      return ctx.badRequest(null, {
        message: "not found",
      });
    }

    const userPaid = detailedCourse.paid_users.some((user) => {
      return user.uuid === ctx.state.user.uuid;
    });
    if (userPaid) {
      console.log("paid");
      return ctx.badRequest(null, {
        message: "invoice can't be issued",
      });
    }

    const redirect_url = `${process.env.FRONTEND_HOST}/redir/${detailedCourse.slug}`;
    const amount = detailedCourse.course_price
      ? parseFloat(detailedCourse.course_price.price) + 3000
      : 5000 - 3000;
    const { email } = ctx.state.user;
    const external_id = `${detailedCourse.slug}-${Date.now() * 2}-${
      detailedCourse.course_price.price
    }`;
    //external_id is reference ID
    const res = await fetch(`https://api.xendit.co/v2/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          Buffer.from(`${process.env.XENDIT_API}:`).toString("base64"),
      },
      body: JSON.stringify({
        external_id,
        amount,
        payer_email: email,
        description: `Beli kelas ${detailedCourse.title}`,
        failure_redirect_url: redirect_url,
        success_redirect_url: redirect_url,
        customer: {
          email,
        },
      }),
    });
    const inv = await res.json();

    if (!res.ok) {
      console.log(inv);
      return ctx.badRequest(null, {
        message: inv.message,
      });
    } else {
      const user = ctx.state.user;
      await strapi.query("waiting-payment").create({
        ex_id: external_id,
        invoice_url: inv.invoice_url,
        user,
        course: { id: courseId },
      });
      console.log("successful invoice creation");
      return {
        invoice_url: inv.invoice_url,
      };
    }
  },
  async rateCourse(ctx) {
    const { id } = ctx.state.user;
    const { uuid } = ctx.params;
    const { rate } = ctx.request.body;
    const course = await strapi.query("courses").find({ uuid });
    if (course.length === 1) {
      const newRating = course[0].rating.filter((rate) => {
        return rate.user.id !== id;
      });

      const result = await strapi
        .query("courses")
        .update({ uuid }, { rating: [...newRating, { rate, user: { id } }] });
      return {
        course: result,
      };
    } else {
      return ctx.notFound();
    }
  },
  async finishVideo(ctx) {
    const { id } = ctx.state.user;
    //uuid is course's uuid,
    //and videoId is singular video's id within a course
    const { uuid, videoId } = ctx.params;

    const course = await strapi.query("courses").find({ uuid });

    const userEnrolled = course[0].enrolled_users.some((user) => {
      return user.uuid === ctx.state.user.uuid;
    });
    if (!userEnrolled) {
      return "Not Found";
    }

    console.log(course[0].grouped_videos);
    console.log(videoId);

    let finishedVidIx = 0;
    let finishedVid = course[0].grouped_videos.videos.filter((v, ix) => {
      if (v.id === parseInt(videoId)) {
        finishedVidIx = ix;
        return true;
      }
    });
    let otherVids = course[0].grouped_videos.videos.filter((v) => {
      return v.id !== parseInt(videoId);
    });
    finishedVid[0].users_finished_watching = [
      ...finishedVid[0].users_finished_watching,
      { id },
    ];
    const res = await strapi.query("grouped-videos").update(
      { id: course[0].grouped_videos.id },
      {
        videos: insertToSpecificIndex(otherVids, finishedVidIx, finishedVid[0]),
      }
    );

    return res;
  },
  async currentMission(ctx) {
    //uuid is course's uuid,
    //and videoId is singular video's id within a course
    const { uuid, videoId } = ctx.params;

    let course = await strapi.query("courses").find({ uuid });

    course[0].grouped_videos.videos = course[0].grouped_videos.videos.filter(
      (vidProp) => vidProp.id === parseInt(videoId)
    );

    const finishedWatching =
      course[0].grouped_videos.videos[0].users_finished_watching.some(
        (user) => {
          return user.uuid === ctx.state.user.uuid;
        }
      );

    if (!finishedWatching) return [];

    const missions = course[0].grouped_videos.videos[0].missions.map((m) => {
      delete m.users_completed_mission;
      return m;
    });

    return missions;
  },
  async doMission(ctx) {
    //uuid is course's uuid,
    //and videoId is singular video's id within a course
    const { id } = ctx.state.user;
    const { uuid, videoId } = ctx.params;

    let course = await strapi.query("courses").find({ uuid });

    const userEnrolled = course[0].enrolled_users.some((user) => {
      return user.uuid === ctx.state.user.uuid;
    });
    if (!userEnrolled) {
      return "Not Found";
    }

    const { missionIds } = ctx.request.body;
    let finishedVidIx = 0;
    let targetVid = course[0].grouped_videos.videos.filter((vidProp, ix) => {
      if (vidProp.id === parseInt(videoId)) {
        finishedVidIx = ix;
        return true;
      }
    });

    console.log(targetVid);

    let otherVids = course[0].grouped_videos.videos.filter((v) => {
      return v.id !== parseInt(videoId);
    });

    targetVid[0].missions.map((m) => {
      if (missionIds.includes(m.id)) {
        m.users_completed_mission = [...m.users_completed_mission, { id }];
      }
      return m;
    });

    const res = await strapi.query("grouped-videos").update(
      { id: course[0].grouped_videos.id },
      {
        videos: insertToSpecificIndex(otherVids, finishedVidIx, targetVid[0]),
      }
    );

    return res;
  },
  async removeWishlistCourse(ctx) {
    const { id } = ctx.state.user;
    const courseId = parseInt(ctx.params.id);
    let wishlist = [];
    const user = await strapi.plugins["users-permissions"].services.user.fetch({
      id,
    });

    wishlist = user.wishlist.filter((c) => c.course.id !== courseId);
    await strapi.plugins["users-permissions"].services.user.edit(
      { id },
      {
        wishlist,
      }
    );
    return wishlist;
  },
  async wishlistCourse(ctx) {
    const { id } = ctx.state.user;
    const courseId = ctx.params.id;

    const user = await strapi.plugins["users-permissions"].services.user.fetch({
      id,
    });
    let alreadyInWishlist = false;
    let sentWishlist = [];

    if (user.wishlist) {
      alreadyInWishlist = user.wishlist.some((c) => {
        return parseInt(courseId) === c.course.id;
      });
    }

    if (!alreadyInWishlist) {
      sentWishlist = [...user.wishlist, { course: { id: courseId } }];

      await strapi.plugins["users-permissions"].services.user.edit(
        { id },
        {
          wishlist: sentWishlist,
        }
      );
      return sentWishlist;
    } else {
      return ctx.badRequest(null, {
        message: "This has been added",
      });
    }
  },
  async enrollCourse(ctx) {
    const { id } = ctx.state.user;
    const { uuid } = ctx.params;
    const course = await strapi.query("courses").find({ uuid });
    if (course.length === 1) {
      const result = await strapi
        .query("courses")
        .update(
          { uuid },
          { enrolled_users: [...course[0].enrolled_users, { id }] }
        );
      return {
        course: result,
      };
    } else {
      return ctx.notFound();
    }
  },
  async find(ctx) {
    let entities;
    let promises;
    let loggedIn = false;
    if (ctx.query._q) {
      entities = await strapi.services.courses.search(ctx.query);
    } else {
      entities = await strapi.services.courses.find(ctx.query);
    }

    if (ctx.state.user) {
      // logged in / authed request
      loggedIn = true;
    }

    promises = entities.map(async (entity) => {
      let course = sanitizeEntity(entity, {
        model: strapi.models.courses,
      });

      let detailedCourse = await strapi
        .query("courses")
        .findOne({ id: course.id }); // this has 'detailed'/complete (but shallow) relationsF
      course.image = detailedCourse.poster.url;
      course.content_creator = detailedCourse.content_creator;
      course.thumbnail = detailedCourse.poster.formats.thumbnail.url;
      course.num_of_participants = detailedCourse.enrolled_users.length;
      course.total_rating =
        course.rating.length > 0
          ? (
              course.rating
                .map((r) => r.rate)
                .reduce((prev, curr) => prev + curr, 0) / course.rating.length
            ).toPrecision(2)
          : 0;

      if (loggedIn) {
        const userEnrolled = course.enrolled_users.some((user) => {
          return user.uuid === ctx.state.user.uuid;
        });
        const userPaid = course.paid_users.some((user) => {
          return user.uuid === ctx.state.user.uuid;
        });

        course.grouped_videos &&
          course.grouped_videos.videos.map((videoObj) => {
            let numberOfMissionsFinished = 0;
            const finishedWatching = videoObj.users_finished_watching.some(
              (user) => {
                return user.uuid === ctx.state.user.uuid;
              }
            );
            videoObj.finished_watching = finishedWatching;
            if (!finishedWatching) {
              videoObj.missions = []; // "hide" missions if user hasnt finished watching
            } else {
              videoObj.missions.map((m) => {
                const userCompletedThisMission = m.users_completed_mission.some(
                  (user) => {
                    return user.uuid === ctx.state.user.uuid;
                  }
                );
                m.completed = userCompletedThisMission;
                if (userCompletedThisMission) numberOfMissionsFinished++;
                delete m.users_completed_mission;
                return m;
              });
            }

            videoObj.all_missions_completed =
              numberOfMissionsFinished === videoObj.missions.length &&
              numberOfMissionsFinished !== 0;
            delete videoObj.users_finished_watching;
          });

        course.enrolled = userEnrolled;
        course.paid = userPaid;
        if (!userPaid) {
          course.grouped_videos &&
            course.grouped_videos.videos.map((videoObj, ix) => {
              if (ix !== 0) {
                Object.keys(videoObj.bunny_video).map((videoProp) => {
                  if (videoProp !== "title" && videoProp !== "duration") {
                    delete videoObj.bunny_video[videoProp];
                  }
                });
              }
            });
          course.bought_on = null;
          course.bought_day_diff = null;
        } else {
          const paidDetails = course.paid_users_detail.filter((detail) => {
            return ctx.state.user.uuid === detail.user.uuid;
          });
          course.bought_on = paidDetails[0].date;
          course.bought_day_diff = dateDiffInDays(
            new Date(course.bought_on),
            new Date()
          );
        }
      } else {
        course.enrolled = false;
        course.paid = false;
        course.bought_on = null;
        course.bought_day_diff = null;

        course.grouped_videos.videos.map((videoObj) => {
          videoObj.finished_watching = false;
          videoObj.missions = [];
          delete videoObj.users_finished_watching;
          Object.keys(videoObj.bunny_video).map((videoProp) => {
            if (videoProp !== "title" && videoProp !== "duration") {
              delete videoObj.bunny_video[videoProp];
            }
          });
        });
      }

      if (course.content_creator) {
        delete course.content_creator.created_at;
        delete course.content_creator.updated_at;
        delete course.content_creator.created_by;
        delete course.content_creator.updated_by;
        delete course.content_creator.uuid;
        delete course.content_creator.published_at;
        delete course.content_creator.id;
      }
      delete course.enrolled_users;
      delete course.rating;
      delete course.paid_users;
      delete course.poster;
      delete course.published_at;
      delete course.created_at;
      delete course.updated_at;
      delete course.paid_users_detail;
      return course;
    });

    return Promise.all(promises);
  },

  async findAllNotTaken(ctx) {
    let entities;
    let formedArr;
    if (ctx.query._q) {
      entities = await strapi.services.courses.search(ctx.query);
    } else {
      entities = await strapi.services.courses.find(ctx.query);
    }
    const { uuid } = ctx.state.user;

    const promises = entities.map(async (entity) => {
      let course = sanitizeEntity(entity, {
        model: strapi.models.courses,
      });
      let detailedCourse = await strapi
        .query("courses")
        .findOne({ id: course.id }); // this has 'detailed'/complete (but shallow) relationsF

      course.content_creator = detailedCourse.content_creator;
      course.num_of_participants = detailedCourse.enrolled_users.length;
      course.enrolled_users = detailedCourse.enrolled_users;
      course.total_rating = (
        course.rating
          .map((r) => r.rate)
          .reduce((prev, curr) => prev + curr, 0) / course.rating.length
      ).toPrecision(2);
      course.grouped_videos &&
        course.grouped_videos.videos.map((vidEntity) => {
          delete vidEntity.video;
          delete vidEntity.users_finished_watching;
          vidEntity.missions = [];
        });

      if (course.poster) {
        course.image = detailedCourse.poster.url;
        course.thumbnail = detailedCourse.poster.formats.thumbnail.url;
        delete course.poster;
      }
      if (course.content_creator) {
        delete course.content_creator.created_at;
        delete course.content_creator.updated_at;
        delete course.content_creator.created_by;
        delete course.content_creator.updated_by;
        delete course.content_creator.uuid;
        delete course.content_creator.published_at;
        delete course.content_creator.id;
      }
      delete course.rating;
      delete course.paid_users;
      delete course.paid_users_detail;
      delete course.published_at;
      delete course.created_at;
      delete course.updated_at;
      return course;
    });
    formedArr = Promise.all(promises);
    formedArr = formedArr.then((r) => {
      const cleanArr = r.filter((el) => {
        const index = el.enrolled_users.findIndex((el) => el.uuid === uuid); // index >= 0 === user is enrolling this class
        return index === -1;
      });
      delete cleanArr[0].enrolled_users;
      return cleanArr;
    });

    return formedArr;
  },

  async findAllTaken(ctx) {
    const { uuid } = ctx.state.user;
    const userCourses = await strapi
      .query("courses")
      .find({ "enrolled_users.uuid": uuid });
    const promises = userCourses.map(async (entity) => {
      let course = sanitizeEntity(entity, {
        model: strapi.models.courses,
      });
      if (course.poster) delete course.poster;
      let detailedCourse = await strapi
        .query("courses")
        .findOne({ id: course.id }); // this has 'detailed'/complete relations
      course.image = detailedCourse.poster.url;
      course.content_creator = detailedCourse.content_creator;
      course.thumbnail = detailedCourse.poster.formats.thumbnail.url;
      course.num_of_participants = detailedCourse.enrolled_users.length;

      const userHasBoughtCourse = detailedCourse.paid_users.some((user) => {
        return user.uuid === uuid;
      });

      const userRatingIndex = detailedCourse.rating.findIndex((rating) => {
        return rating.user.uuid === uuid;
      });

      if (userHasBoughtCourse) {
        course.paid = true;
      } else {
        course.paid = false;
      }

      if (userRatingIndex >= 0) {
        course.my_rating = detailedCourse.rating[userRatingIndex].rate;
      } else {
        course.my_rating = 0;
      }
      delete course.total_rating; // no idea how it's still there
      delete course.updated_at;
      delete course.paid_users;
      delete course.paid_users_detail;
      delete course.rating;
      delete course.published_at;
      delete course.created_at;
      delete course.updated_at;
      delete course.enrolled_users;
      if (course.content_creator) {
        delete course.content_creator.created_at;
        delete course.content_creator.updated_at;
        delete course.content_creator.created_by;
        delete course.content_creator.updated_by;
        delete course.content_creator.uuid;
        delete course.content_creator.published_at;
        delete course.content_creator.id;
      }
      let num_of_course_finished = 0;
      let totalDuration = 0;

      course.grouped_videos &&
        course.grouped_videos.videos.map((vidEntity, ix) => {
          let numOfMissions = vidEntity.missions.length;
          let numberOfMissionsFinished = 0;
          vidEntity.duration_seconds = vidEntity.bunny_video.duration;
          if (ix !== 0) {
            delete vidEntity.video;
          }

          vidEntity.missions.map((m) => {
            const userCompletedThisMission = m.users_completed_mission.some(
              (user) => {
                return user.uuid === ctx.state.user.uuid;
              }
            );

            m.completed = userCompletedThisMission;
            if (userCompletedThisMission) numberOfMissionsFinished++;

            vidEntity.all_missions_completed =
              numberOfMissionsFinished === 0
                ? false
                : numberOfMissionsFinished === numOfMissions; // if user completed 0 missions, then should be false

            if (vidEntity.all_missions_completed) num_of_course_finished++;
            delete m.users_completed_mission;
          });
          if (!vidEntity.all_missions_completed) {
            vidEntity.missions = [];
          } else {
            totalDuration += parseFloat(vidEntity.duration_seconds);
          }

          delete vidEntity.users_finished_watching;
        });
      course.all_videos_finished_duration_seconds = totalDuration;
      course.percentage_course_finished = course.grouped_videos
        ? parseInt(
            (num_of_course_finished / course.grouped_videos.videos.length) * 100
          )
        : 0;
      return course;
    });

    return Promise.all(promises);
  },
};
