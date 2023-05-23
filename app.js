const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializationDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is Running at http://localhost:3000");
    });
  } catch (error) {
    console.log(`Database Error: ${error.message}`);
    process.exit(1);
  }
};

initializationDBAndServer();

//1.''''''''''''''''''''Create A User in database'''''''''''''''''''''''
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `
    SELECT 
        *
    FROM
        user
    WHERE
        username = '${username}';`;
  const checkingUser = await db.get(selectUserQuery);
  if (checkingUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
            INSERT INTO
                user(name, username, password, gender)
            VALUES
                (
                  '${name}',
                  '${username}',
                  '${hashedPassword}',
                  '${gender}'
                );`;
      const createUserInDB = await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//2.........................Login user ............................
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT
        *
    FROM
        user
    WHERE
        username = '${username}';`;
  const checkUserInDB = await db.get(selectUserQuery);
  if (checkUserInDB === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPassword = await bcrypt.compare(password, checkUserInDB.password);
    if (isPassword === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "abcdefghijkl");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//-------------Middleware function for JWT Token Authentication-------------
const authenticationMiddleware = async (request, response, next) => {
  const authToken = request.headers["authorization"];
  let jwtToken;
  if (authToken !== undefined) {
    jwtToken = authToken.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "abcdefghijkl", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        const selectUserQuery = `
            SELECT
                *
            FROM
                user
            WHERE 
                username = '${payload.username}';`;
        const getUserDetailsFromDB = await db.get(selectUserQuery);
        request.userDetails = getUserDetailsFromDB;
        next();
      }
    });
  }
};

//3.++++++++++++++++++++ GET The Latest Tweets ++++++++++++++++++
app.get(
  "/user/tweets/feed/",
  authenticationMiddleware,
  async (request, response) => {
    const { userDetails } = request;
    const { username, user_id } = userDetails;
    const getLatestTweetsQuery = `
        SELECT
            username,
            tweet,
            date_time AS dateTime
        FROM
            (user NATURAL JOIN tweet) AS userId INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE
            following_user_id = ${user_id}    
        ORDER BY
            date_time ASC
        LIMIT
            4;`;
    const latestTweetsFromDB = await db.all(getLatestTweetsQuery);
    response.send(latestTweetsFromDB);
  }
);

//4."""""""""""""""""""" GET User Following Names """"""""""""""""""""""\\
app.get(
  "/user/following/",
  authenticationMiddleware,
  async (request, response) => {
    const { userDetails } = request;
    const { username, user_id } = userDetails;
    const getFollowersQuery = `
        SELECT 
            name
        FROM
            user INNER JOIN follower ON user.user_id = follower.following_user_id
        WHERE
            follower_user_id = '${user_id}';`;
    const getFollowersFromDB = await db.all(getFollowersQuery);
    response.send(getFollowersFromDB);
  }
);

//5.`````````````````` GET USER FOLLOWERS API ````````````````````
app.get(
  "/user/followers/",
  authenticationMiddleware,
  async (request, response) => {
    const { userDetails } = request;
    const { username, user_id } = userDetails;
    const getUserFollowersQuery = `
        SELECT 
            name
        FROM
            user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE
            following_user_id = ${user_id};`;
    const getUserFollowersFromDB = await db.all(getUserFollowersQuery);
    response.send(getUserFollowersFromDB);
  }
);

//---------User only get the following users data Middleware function ----------//
const userRestrictionsMiddleware = async (request, response, next) => {
  const { userDetails } = request;
  const { username, user_id, name } = userDetails;
  const getOnlyUserFollowingUsersDataQuery = `
    SELECT
        *
    FROM 
        follower
    WHERE
        follower_user_id = ${user_id};`;
  const getResponseFromDB = await db.all(getOnlyUserFollowingUsersDataQuery);
  if (getResponseFromDB === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    //console.log(getResponseFromDB);
    request.userFollowingUsersData = getResponseFromDB;
    next();
  }
};

//6.~~~~~~~~~~~~~~~~~~~~~~ GET User following users tweets ~~~~~~~~~~~~~~~~~~~~~\\
app.get(
  "/tweets/:tweetId/",
  authenticationMiddleware,
  userRestrictionsMiddleware,
  async (request, response) => {
    const { userFollowingUsersData } = request;
    const { tweetId } = request.params;
    const userFollowingUserNames = [];
    userFollowingUsersData.map((eachUser) => {
      let userName = eachUser.following_user_id;
      userFollowingUserNames.push(userName);
    });
    const getTweetDetailsQuery = `
        SELECT
            tweet.user_id AS user_id,
            tweet,
            SUM(like_id) AS likes,
            SUM(reply_id) AS replies,
            date_time AS dateTime
        FROM
            (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS tweetLike
            INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE
            tweet.tweet_id = ${tweetId};`;
    const tweetDetailsFromDB = await db.get(getTweetDetailsQuery);
    if (tweetDetailsFromDB !== undefined) {
      const getTweetUserId = tweetDetailsFromDB.user_id;
      const userFollowingThisUser = userFollowingUserNames.includes(
        getTweetUserId
      );

      if (userFollowingThisUser) {
        const sendingToClient = {
          tweet: tweetDetailsFromDB.tweet,
          likes: tweetDetailsFromDB.likes,
          replies: tweetDetailsFromDB.replies,
          dateTime: tweetDetailsFromDB.dateTime,
        };
        response.send(sendingToClient);
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//7.::::::::: GET The User follows user tweet Details who is like that Tweet ::::::::::::
app.get(
  "/tweets/:tweetId/likes/",
  authenticationMiddleware,
  userRestrictionsMiddleware,
  async (request, response) => {
    const { userFollowingUsersData } = request;
    const { tweetId } = request.params;
    const userFollowingUserNames = [];
    userFollowingUsersData.map((eachUser) => {
      let userName = eachUser.following_user_id;
      userFollowingUserNames.push(userName);
    });
    const getTweetIdQuery = `
        SELECT 
            *
        FROM
            tweet
        WHERE
            tweet_id = ${tweetId};`;
    const dbResponse = await db.get(getTweetIdQuery);
    if (dbResponse !== undefined) {
      const isTweetByFollowingUser = userFollowingUserNames.includes(
        dbResponse.user_id
      );
      //console.log(isTweetByFollowingUser);
      if (isTweetByFollowingUser) {
        const getTweetLikedUserNamesQuery = `
            SELECT
                *
            FROM
                user NATURAL JOIN like
            WHERE
                tweet_id = ${tweetId};`;
        const getLikerNamesFromDb = await db.all(getTweetLikedUserNamesQuery);
        const likerNames = [];
        getLikerNamesFromDb.map((eachUser) => {
          const nameOfLiker = eachUser.username;
          likerNames.push(nameOfLiker);
        });
        const responseToClient = {
          likes: likerNames,
        };
        response.send(responseToClient);
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//8.**************** GET reply Details of User Following users *******************

app.get(
  "/tweets/:tweetId/replies/",
  authenticationMiddleware,
  userRestrictionsMiddleware,
  async (request, response) => {
    const { userFollowingUsersData } = request;
    const { tweetId } = request.params;
    const userFollowingUserNames = [];
    userFollowingUsersData.map((eachUser) => {
      let userName = eachUser.following_user_id;
      userFollowingUserNames.push(userName);
    });
    const getTweetIdQuery = `
        SELECT 
            *
        FROM 
            tweet
        WHERE
            tweet_id = ${tweetId};`;
    const responseFromDB = await db.get(getTweetIdQuery);
    if (responseFromDB !== undefined) {
      const isFollowingUser = userFollowingUserNames.includes(
        responseFromDB.user_id
      );
      if (isFollowingUser) {
        const getReplyDetailsQuery = `
            SELECT
                name,
                reply
            FROM
                user NATURAL JOIN reply
            WHERE
                tweet_id = ${tweetId};`;
        const replyDetailsFromDB = await db.all(getReplyDetailsQuery);
        const replies = {
          replies: replyDetailsFromDB,
        };
        response.send(replies);
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//9. ##################### GET A User All Tweets ###############################
app.get(
  "/user/tweets/",
  authenticationMiddleware,
  userRestrictionsMiddleware,
  async (request, response) => {
    const { userDetails } = request;
    const { user_id } = userDetails;
    console.log(user_id);
    const getTweetIDsQuery = `
        SELECT
            *
        FROM
            tweet
        WHERE
            user_id = ${user_id};`;
    const getTweetsFromDB = await db.all(getTweetIDsQuery);
    //console.log(getTweetsFromDB);
    const getTweetIdsList = getTweetsFromDB.map((eachOne) => eachOne.tweet_id);
    let userAllTweetsList = await Promise.all(
      getTweetIdsList.map(async (tweetIds) => {
        const getTweetLikesAndReplyQuery = `
            SELECT
                tweet,
                SUM(like_id) AS likes,
                SUM(reply_id) AS replies,
                date_time AS dateTime
            FROM
                (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS tweetLike INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
            WHERE
                tweet.tweet_id = ${tweetIds};`;
        const getTweetFromDatabase = await db.get(getTweetLikesAndReplyQuery);
        return getTweetFromDatabase;
      })
    );
    response.send(userAllTweetsList);
  }
);

////////////Create Current Date And Time Function\\\\\\\\\\\\\\\
const createTimeAndDate = () => {
  const currentDate = new Date();
  const indianTimeOffSet = 5.5;
  const getYear = currentDate.getFullYear();
  const getMonth = currentDate.getMonth();
  const getDay = currentDate.getDate();
  const getHours = currentDate.getHours();
  const getMinutes = currentDate.getMinutes();
  const getSeconds = currentDate.getSeconds();

  const utcDate = Date.UTC(
    getYear,
    getMonth,
    getDay,
    getHours,
    getMinutes,
    getSeconds
  );
  const indianDate = new Date(utcDate + indianTimeOffSet * 60 * 60 * 1000);
  const formatDate = indianDate.toISOString().replace("T", " ").slice(0, 19);
  return formatDate;
};
//10.^^^^^^^^^^^^^^^^^^^^^^^^Create a Tweet ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
app.post(
  "/user/tweets/",
  authenticationMiddleware,
  async (request, response) => {
    const { userDetails } = request;
    const { user_id } = userDetails;
    const { tweet } = request.body;
    const currentDate = createTimeAndDate();
    const addTweetQuery = `
        INSERT INTO
            tweet(tweet, user_id, date_time)
        VALUES('${tweet}', ${user_id}, '${currentDate}');`;
    await db.run(addTweetQuery);
    response.send("Created a Tweet");
  }
);

//!!!!!!!!!!!!!!!!!!!!!!!!!!!! DELETE A Tweet !!!!!!!!!!!!!!!!!!!!!!
app.delete(
  "/tweets/:tweetId/",
  authenticationMiddleware,
  userRestrictionsMiddleware,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userDetails } = request;
    const { user_id } = userDetails;
    const getTweetIdQuery = `
        SELECT 
            *
        FROM
            tweet
        WHERE
            tweet_id = ${tweetId};`;
    const dbResp = await db.get(getTweetIdQuery);
    if (dbResp !== undefined) {
      if (userDetails.user_id === dbResp.user_id) {
        const deleteTweetQuery = `
            DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
        const repFromDB = await db.run(deleteTweetQuery);
        response.send("Tweet Removed");
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
