import express from "express";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import { getS3Config } from "../config/config.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CONFIG
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

/* =========================================
   AWS S3 CLIENT
========================================= */

const getAWSConfig = () => {
  const s3Config = getS3Config();
  return {
    accessKeyId: s3Config.AWS_ACCESS_KEY_ID,
    secretAccessKey: s3Config.AWS_SECRET_ACCESS_KEY,
    region: s3Config.AWS_REGION,
  };
};

const getS3 = () => {

  const awsConfig =
    getAWSConfig();

  return new S3Client({
    region: awsConfig.region,
    credentials: {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey,
    }
  });
};

/* =========================================
   HELPERS
========================================= */

function formatBytes(bytes) {

  if (!bytes || bytes === 0) {
    return "0 MB";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const i = Math.floor(
    Math.log(bytes) / Math.log(1024)
  );

  return (
    (bytes / Math.pow(1024, i)).toFixed(2) +
    " " +
    units[i]
  );
}

function formatDate(dateStr) {

  if (!dateStr) return "Unknown";

  const date = new Date(dateStr);

  if (isNaN(date.getTime())) {
    return "Unknown";
  }

  return date
    .toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
    .replace(",", "")
    .replace(/\//g, "-");
}

function formatETADate(dateStr) {

  if (!dateStr) return "Unknown";

  const date = new Date(dateStr);

  if (isNaN(date.getTime())) {
    return "Unknown";
  }

  return date
    .toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    })
    .replace(/\//g, "-");
}

function toTimestamp(dateStr) {

  if (!dateStr) return 0;

  const t = Date.parse(dateStr);

  return isNaN(t) ? 0 : t;
}

function calculateDelayDays(lastUpdate) {

  if (!lastUpdate) return null;

  const lastUpdateTime =
    new Date(lastUpdate);

  const now = new Date();

  const lastUpdateStart =
    new Date(lastUpdateTime);

  lastUpdateStart.setHours(0, 0, 0, 0);

  const nowStart = new Date(now);

  nowStart.setHours(0, 0, 0, 0);

  if (
    lastUpdateStart.getTime() ===
    nowStart.getTime()
  ) {
    return 0;
  }

  let days = 0;

  let currentDate =
    new Date(lastUpdateStart);

  currentDate.setDate(
    currentDate.getDate() + 1
  );

  while (currentDate <= nowStart) {

    // Skip Sunday
    if (currentDate.getDay() !== 0) {
      days++;
    }

    currentDate.setDate(
      currentDate.getDate() + 1
    );
  }

  return days;
}

/* =========================================
   USER MAPPING
========================================= */

const userMapping = [
  {
    name: "Abuthahir A",
    email: "abuthahir@theunitytech.com",
    short_name: "AA"
  },
  {
    name: "Abhinav Singh",
    email: "abhinav@theunitytech.com",
    short_name: "AS"
  },
  {
    name: "Akashvel M",
    email: "akashvel@theunitytech.com",
    short_name: "AM"
  },
  {
    name: "Akil Sw",
    email: "akileswar@theunitytech.com",
    short_name: "AS"
  },
  {
    name: "Amal Kp",
    email: "amal@theunitytech.com",
    short_name: "AK"
  },
  {
    name: "Anjali Priya",
    email: "anjalipriya@theunitytech.com",
    short_name: "AP"
  },
  {
    name: "Aparna Ashok",
    email: "aparna.a@theunitytech.com",
    short_name: "AA"
  },
  {
    name: "Arun M",
    email: "arun.m@theunitytech.com",
    short_name: "AM"
  },
  {
    name: "Vipin Sharma",
    email: "vipinsharma.r@theunitytech.com",
    short_name: "VS"
  },
  {
    name: "Deepika S",
    email: "deepika.s@theunitytech.com",
    short_name: "DS"
  },
  {
    name: "Dhinesh Vinayak G",
    email: "dhineshvinayak@theunitytech.com",
    short_name: "DG"
  },
  {
    name: "Gibson Sam",
    email: "gibsonvictor@theunitytech.com",
    short_name: "GS"
  },
  {
    name: "Immaculain G",
    email: "immaculain@theunitytech.com",
    short_name: "IG"
  },
  {
    name: "Karthick Periasami",
    email: "karthick.p@theunitytech.com",
    short_name: "KP"
  },
  {
    name: "Kavin S",
    email: "kavin.s@theunitytech.com",
    short_name: "KS"
  },
  {
    name: "Manikandan G",
    email: "manikandan@theunitytech.com",
    short_name: "MG"
  },
  {
    name: "Meera R",
    email: "meera.r@theunitytech.com",
    short_name: "MR"
  },
  {
    name: "Ameen Mhd",
    email: "mohammedameen.ot@theunitytech.com",
    short_name: "AM"
  },
  {
    name: "Muthuvelraj Kumaran",
    email: "muthuvelraj.k@theunitytech.com",
    short_name: "MK"
  },
  {
    name: "Nathishma N",
    email: "nathishma.n@theunitytech.com",
    short_name: "NN"
  },
  {
    name: "Pushkal Sharma",
    email: "pushkal@theunitytech.com",
    short_name: "PS"
  },
  {
    name: "Rajesh Kanna",
    email: "rajeshkanna.s@theunitytech.com",
    short_name: "RK"
  },
  {
    name: "Ram Prasath",
    email: "ramprasath.r@theunitytech.com",
    short_name: "RP"
  },
  {
    name: "Rathna Vel S",
    email: "rathnavel@theunitytech.com",
    short_name: "RS"
  },
  {
    name: "Sahil Nandal",
    email: "sahil.s@theunitytech.com",
    short_name: "SN"
  },
  {
    name: "Sankarganesh R",
    email: "sankarganesh@theunitytech.com",
    short_name: "SR"
  },
  {
    name: "Saru Saravanan",
    email: "saravanant@theunitytech.com",
    short_name: "SS"
  },
  {
    name: "Ida Scader",
    email: "scader.ida@theunitytech.com",
    short_name: "IS"
  },
  {
    name: "Shivaji R",
    email: "shivaji.r@theunitytech.com",
    short_name: "SR"
  },
  {
    name: "Sivaprasath K",
    email: "sivaprasath.k@theunitytech.com",
    short_name: "SK"
  },
  {
    name: "Vaishnavi Saravanan",
    email: "vaishnavi.s@theunitytech.com",
    short_name: "VS"
  },
  {
    name: "Varsha Viswanathan",
    email: "varsha.v@theunitytech.com",
    short_name: "VV"
  },
  {
    name: "Vimal S",
    email: "vimal.s@theunitytech.com",
    short_name: "VS"
  },
  {
    name: "Vishaal Premkumar",
    email: "vishaalpremkumar@theunitytech.com",
    short_name: "VP"
  }
];

function getUserDetailsByEmail(email) {

  const user = userMapping.find(
    (u) => u.email === email
  );

  if (user) {

    return {
      fullname: user.name,
      short_name: user.short_name,
    };
  }

  return {
    fullname: email || "Unknown",
    short_name: email
      ? email.substring(0, 2).toUpperCase()
      : "UN",
  };
}

/* =========================================
   ACTIVE GAMES API
========================================= */

router.get(
  "/active-games",

  async (req, res) => {

    const supabase = getSupabase();
    const s3 = getS3();
    
    try {

      console.log(
        "\n🚀 ACTIVE GAMES API HIT"
      );

      const bucket =
        process.env.S3_BUCKET_NAME;

      /* ===== ACTIVE GAMES ===== */

      // Get the actual column names - remove AS aliases
      const { data: games, error: gamesError } = await supabase
        .from('gameinfodetails')
        .select(`
          id,
          name,
          gamelabel,
          gamecategory,
          current_status,
          current_verson,
          gameassignee,
          last_transfered,
          ETA,
          priority
        `)
        .eq('isgameactive', 1);

      if (gamesError) {
        throw new Error(gamesError.message);
      }

      // Map the fields to match expected property names
      const mappedGames = games.map(g => ({
        ...g,
        phase: g.gamelabel,
        category: g.gamecategory,
        tester: g.gameassignee
      }));

      const gameNames =
        mappedGames.map((g) => g.name);

      /* ===== BUILDS ===== */

      const { data: builds, error: buildsError } = await supabase
        .from('builduser')
        .select(`
          gamename,
          username,
          email,
          lastupdate
        `)
        .in('gamename', gameNames)
        .in('useraction', ['Build Uploaded', 'Build is uploaded and moved to testing'])
        .order('id', { ascending: false });

      if (buildsError) {
        throw new Error(buildsError.message);
      }

      const latestBuild = {};

      for (const b of builds || []) {

        if (!latestBuild[b.gamename]) {
          latestBuild[b.gamename] = b;
        }
      }

      /* ===== S3 ROOT ===== */

      const s3Root = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Delimiter: "/",
        })
      );

      const s3Folders = new Set(
        (s3Root.CommonPrefixes || []).map(
          (p) =>
            p.Prefix.replace("/", "")
        )
      );

      /* ===== S3 SCAN ===== */

      const s3Calls = gameNames.map(
        (game) => {

          if (!s3Folders.has(game)) {

            return Promise.resolve({
              game,
              size: 0,
            });
          }

          return s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: `${game}/`,
            })
          ).then((res) => {

            let total = 0;

            if (res.Contents) {

              for (const obj of res.Contents) {
                total += obj.Size || 0;
              }
            }

            return {
              game,
              size: total,
            };
          });
        }
      );

      const s3Results =
        await Promise.all(s3Calls);

      const sizeMap = {};

      for (const s of s3Results) {
        sizeMap[s.game] = s.size;
      }

      /* ===== FINAL ITEMS ===== */

      const items = mappedGames.map((g) => {

        const b =
          latestBuild[g.name] || {};

        const testerDetails =
          getUserDetailsByEmail(
            g.tester
          );

        const developerDetails =
          getUserDetailsByEmail(
            b.email
          );

        const tsBuild =
          toTimestamp(
            b.lastupdate
          );

        const tsTrans =
          toTimestamp(
            g.last_transfered
          );

        let pendingDays = 0;

        if (
          g.current_status ===
          "Pending on Dev Team"
        ) {

          pendingDays =
            calculateDelayDays(
              g.last_transfered
            );

        } else if (
          g.current_status ===
          "Pending on Testing Team"
        ) {

          pendingDays =
            calculateDelayDays(
              b.lastupdate
            );
        }

        return {
          id: g.id,
          gamename: g.name,
          phase: g.phase,
          category: g.category,
          status: g.current_status,
          version: g.current_verson,
          eta: formatETADate(g.ETA),

          tester: g.tester || "N/A",

          tester_fullname:
            testerDetails.fullname,

          tester_short_name:
            testerDetails.short_name,

          transferred:
            formatDate(
              g.last_transfered
            ),

          developer:
            b.username || "Unknown",

          developer_fullname:
            developerDetails.fullname,

          developer_short_name:
            developerDetails.short_name,

          developer_email:
            b.email || "N/A",

          modified:
            formatDate(
              b.lastupdate
            ),

          size:
            formatBytes(
              sizeMap[g.name] || 0
            ),

          priority:
            Number(g.priority) || 0,

          recentTimestamp:
            Math.max(
              tsBuild,
              tsTrans
            ),

          pendingDays,
        };
      });

      /* ===== SORT ===== */

      items.sort((a, b) => {

        if (
          b.priority !== a.priority
        ) {
          return (
            b.priority - a.priority
          );
        }

        return (
          b.recentTimestamp -
          a.recentTimestamp
        );
      });

      /* ===== OUTPUT ===== */

      const output = items.map(
        (i) => ({
          id: i.id,
          gamename: i.gamename,
          phase: i.phase,
          category: i.category,
          status: i.status,
          version: i.version,
          eta: i.eta,

          tester: i.tester,
          tester_fullname:
            i.tester_fullname,
          tester_short_name:
            i.tester_short_name,

          transferred:
            i.transferred,

          developer:
            i.developer,

          developer_fullname:
            i.developer_fullname,

          developer_short_name:
            i.developer_short_name,

          developer_email:
            i.developer_email,

          modified:
            i.modified,

          size: i.size,

          priority:
            i.priority,

          pendingDays:
            i.pendingDays,
        })
      );

      return res.json({
        success: true,
        data: output,
      });

    } catch (err) {

      console.error(
        "🔥 /active-games ERROR:",
        err
      );

      return res.status(500).json({
        success: false,
        error: "Server error",
        details: err.message,
      });

    }
  }
);

/* =========================================
   LATEST UI DOCUMENT
========================================= */

router.get(
  "/game-latest-ui-document/:gameName",

  async (req, res) => {

    const supabase = getSupabase();
    const { gameName } = req.params;

    try {

      const { data: rows, error } = await supabase
        .from('builduser')
        .select(`
          command,
          lastupdate
        `)
        .eq('gamename', gameName)
        .eq('useraction', 'UIdesign_upload')
        .order('id', { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      if (
        !rows ||
        rows.length === 0 ||
        !rows[0].command
      ) {

        return res.json({
          success: false,
          message:
            "No UI document found",
        });
      }

      return res.json({
        success: true,
        url: rows[0].command,
        lastUpdate:
          rows[0].lastupdate,
      });

    } catch (error) {

      console.error(
        "🔥 UI DOCUMENT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Internal server error",
      });

    }
  }
);

export default router;