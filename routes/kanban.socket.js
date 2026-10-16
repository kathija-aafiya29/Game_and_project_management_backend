import { WebSocketServer, WebSocket } from "ws";
import { verifySocketToken } from "../utils/jwt.js";
import { isTokenBlacklisted } from "../utils/tokenBlacklist.js";
import { createTicket, getAllTickets, updateTicket, saveBugAttachments, deleteTicket, getActivityLogs, AddComments, deleteComment, updateComment, updateBugDescription, removeBugAttachments, createBulkTickets } from "../controller/bugController.js";
import { getDropdownList } from "../controller/commonController.js";
import { createNotification } from "../services/notificationService.js";
import { bugsByStatus, dashboardHighSeverityBugs, openBugsByAssignee, statusCountByGame } from "../controller/dashBoardController.js";
import { getEmailByUserId, getUserNameById, getCurrentISTForMySQL } from "../helpers/commonHelper.js";
import { getDB } from "../config/db.js";

const boards = new Map();

export default function kanbanSocket(ws) {
  // boardId => Map(userId => Set(ws))

  ws.isAlive = true;
  ws.userId = null;
  ws.boardId = null;

  console.log("🔌 Kanban WS connected");

  ws.on("ping", () => { ws.isAlive = true; });
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      await handleMessage(ws, msg);
    } catch (err) {
      console.error("Invalid Kanban WS message:", err);
    }
  });
  ws.on("close", () => {
    console.log("❌ Kanban WS disconnected");
    cleanup(ws);
  });
  ws.on("error", (err) => {
    console.error("Kanban WS error:", err);
    cleanup(ws);
  });



  // MESSAGE HANDLER
  async function handleMessage(ws, { type, payload }) {
    if (type === "JOIN_BOARD") return authenticateAndJoin(ws, payload);
    if (!ws.userId || !ws.boardId) return ws.close(4001, "Unauthorized");

    if (type === "PING") return ws.send(JSON.stringify({ type: "PONG" }));
    if (type === "LEAVE_BOARD") { cleanup(ws); return ws.send(JSON.stringify({ type: "LEFT_BOARD" })); }
    if (type === "GET_USERS") {
      const board = boards.get(ws.boardId);
      const users = board ? Array.from(board.keys()) : [];
      return ws.send(JSON.stringify({ type: "BOARD_USERS", payload: { boardId: ws.boardId, users } }));
    }
    if (type === "GET_ALL_USERS") {
      const allBoards = [];
      boards.forEach((boardMap, boardId) => {
        const users = Array.from(boardMap.keys());
        allBoards.push({ boardId, users });
      });
      return ws.send(JSON.stringify({ type: "ALL_BOARD_USERS", payload: allBoards }));
    }

    // Kanban Events
    switch (type) {
      case "CREATE_CARD": return handleCreateCard(ws, payload);
      //Bulk upload
      case "CREATE_BULK_CARDS":
      return handleBulkCreateCards(ws, payload);
      case "UPDATE_CARD": return handleUpdateCard(ws, payload);
      case "DELETE_CARD": return handleDeleteCard(ws, payload);
      //   case "MOVE_CARD": return handleMoveCard(ws, payload);
      case "GET_ALL_TICKETS": return handleGetAllTickets(ws, payload);
      case "DROPDOWN_LIST": return handleDropdownRequest(ws, payload);
      //   case "GET_USER_TICKETS": return handleGetUserTickets(ws);
      case "UPLOAD_FILES":
        return handleUploadFiles(ws, payload);

      case "REMOVE_FILES":
        return handleRemoveFiles(ws, payload);

      case "UPDATE_DESCRIPTION":
        return handleUpdateDescription(ws, payload);

      case "GET_ACTIVITY_LOGS":
        return handleGetActivityLogs(ws, payload);

      case "ADD_COMMENT":
        return handleAddComment(ws, payload);
      case "UPDATE_COMMENT":
        return handleUpdateComment(ws, payload);
      case "DELETE_COMMENT":
        return handleDeleteComment(ws, payload);
      case "DASHBOARD_STATUS_COUNT":
        return statusCountByGamedata(ws, payload);
      case "DASHBOARD_HIGH_SEVERITY_BUGS":
        return HighSeverityBugs(ws, payload);
      case "DASHBOARD_OPEN_BUGS_BY_ASSIGNEES":
        return openBugsByAssignees(ws, payload);
      case "DASHBOARD_BUGS_BY_STATUS":
        return bugByStatus(ws, payload);
      default: return ws.send(JSON.stringify({ type: "ERROR", message: "Unknown socket event" }));
    }
  }

  function authenticateAndJoin(ws, { boardId, token }) {
    try {
      if (!token) {
        ws.send(JSON.stringify({
          type: "AUTH_FAILED",
          reason: "TOKEN_MISSING",
          message: "Authentication token missing"
        }));
        ws.close();
        return;
      }

      if (isTokenBlacklisted(token)) {
        ws.send(JSON.stringify({
          type: "AUTH_FAILED",
          reason: "TOKEN_REVOKED",
          message: "Token has been revoked"
        }));
        ws.close();
        return;
      }

      const decoded = verifySocketToken(token); // throws if expired

      console.log("Kanban AUTH success for user:", decoded, "on board:", boardId);
      ws.userId = decoded.sub;
      ws.email = decoded.email;
      ws.boardId = boardId;

      if (!boards.has(boardId)) boards.set(boardId, new Map());
      if (!boards.get(boardId).has(ws.userId)) boards.get(boardId).set(ws.userId, new Set());
      boards.get(boardId).get(ws.userId).add(ws);

      ws.send(JSON.stringify({
        type: "AUTH_SUCCESS",
        payload: { boardId, userId: ws.userId }
      }));

    } catch (err) {
      console.error("Kanban AUTH failed:", err);

      if (err.name === "TokenExpiredError") {
        ws.send(JSON.stringify({
          type: "AUTH_EXPIRED",
          message: "Session expired. Please login again."
        }));
      } else {
        ws.send(JSON.stringify({
          type: "AUTH_FAILED",
          reason: "INVALID_TOKEN",
          message: "Invalid authentication token"
        }));
      }

      ws.close();
    }
  }


  // CLEANUP
  function cleanup(ws) {
    const { boardId, userId } = ws;
    if (!boardId || !userId) return;

    const board = boards.get(boardId);
    if (!board) return;

    const sockets = board.get(userId);
    if (!sockets) return;

    sockets.delete(ws);
    if (sockets.size === 0) board.delete(userId);
    if (board.size === 0) boards.delete(boardId);
  }

  // BROADCAST
  function broadcast(ws, type, payload) {
    const board = boards.get(ws.boardId);
    console.log("Broadcasting on board:", ws.boardId);
    if (!board) return;

    const message = JSON.stringify({ type, payload });

    let totalSockets = 0;

    board.forEach((socketSet, userId) => {
      socketSet.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          totalSockets++;
        }
      });
    });

    console.log("📢 Broadcasting to", totalSockets, "sockets");
  }

  // KANBAN HANDLERS
  //bulk upload
  async function handleCreateCard(ws, payload) {
    console.log("Creating card with payload:", payload);
    try {
      const { name, game_id } = payload;
      if (!name || !game_id) return ws.send(JSON.stringify({ type: "ERROR", message: "Missing name or game_id" }));

      const card = await createTicket({ name, game_id, userId: ws.userId });
      broadcast(ws, "CARD_CREATED", card);
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to create card" })); }
  }
  // bulk upload
  async function handleBulkCreateCards(ws, payload) {
    console.log("Creating cards with payload:", payload);
  try {
    const { game_id, tickets } = payload;

    if (!game_id || !tickets?.length) {
      return ws.send(
        JSON.stringify({
          type: "ERROR",
          message: "game_id and tickets are required",
        })
      );
    }

    const createdTickets = await createBulkTickets({
      game_id,
      tickets,
      userId: ws.userId,
    });

   // acknowledgement only to creator
    ws.send(
      JSON.stringify({
        type: "BULK_CARDS_CREATED",
        payload: {
          cards: createdTickets,
          created_by: ws.userId,
        },
      })
    );

    // broadcast to everyone
    broadcast(ws, "BULK_CARDS_CREATED", {
      cards: createdTickets,
      created_by: ws.userId,
    });
  } catch (err) {
    console.error(err);

    ws.send(
      JSON.stringify({
        type: "ERROR",
        message: err.message || "Bulk ticket creation failed",
      })
    );
  }
}

  async function handleUpdateCard(ws, payload) {
    try {
      const { id, name, status, assignee, reported_by, severity, platform, environment } = payload;
      if (!id) return ws.send(JSON.stringify({ type: "ERROR", message: "Id is required" }));

      const card = await updateTicket({ id, name, status, assignee, reported_by, severity, platform, environment, userId: ws.userId });
      if (card?.data?.assigneeChanged && card?.data?.assignee_id) {
        const email = await getEmailByUserId(card?.data?.assignee_id);
        const notificationId = await createNotification({
          userId: email,
          type: "ticket_assigned",
          title: "New Ticket Assigned",
          message: `You have been assigned ticket #${card.data.bug_id}`,
          context: {
            ticket_id: card.data.id,
            game_id: card.data.game_id,
            action: "assigned",
          },
          sourceId: ws.email,
        });

        // sendPushToUser(card.data.assignee_id, {
        //   title: "New Ticket Assigned",
        //   body: `You have been assigned ticket #${card.data.id}`
        // });
        console.log("Sending notification to user:", card.data.assignee_id, "with email:", card.data.userEmail);
        console.log("Notification email:", ws.email);
        console.log("Global:", global.sendNotification);
        if (global.sendNotification) {
          const currentTime = getCurrentISTForMySQL();
          try {
            await global.sendNotification(
              card.data.userEmail, // must be email
              {
                id: notificationId,
                user_id: card.data.assignee_id,
                type: "ticket_assigned",
                title: "New Ticket Assigned",
                message: `You have been assigned ticket #${card.data.bug_id}`,
                context: {
                  ticket_id: card.data.id,
                  game_id: card.data.game_id,
                  action: "assigned",
                },
                source_id: ws.email,
                environment: "internal",
                is_read: false,
                created_at: currentTime
              },
              {
                shouldNotifySelf: false
              }
            );
          } catch (err) {
            console.error("❌ WS notification error:", err);
          }
        } else {
          console.warn("⚠️ global.sendNotification not available");
        }
      }
      if (card?.data?.statusChanged && status == 3) {
        {
          const email = await getEmailByUserId(card?.data?.created_by);
          const username = await getUserNameById(ws.userId);
          const notificationId = await createNotification({
            userId: email,
            type: "ticket_moved_to_inreview",
            title: "Ticket Moved to In Review",
            message: `#${card.data.bug_id} from ${card.data.gameName} was moved to In Review by ${username}`,
            context: {
              ticket_id: card.data.id,
              game_id: card.data.game_id,
              action: "moved_to_in_review",
            },
            sourceId: ws.email,
          });
          if (global.sendNotification) {
            const currentTime = getCurrentISTForMySQL();
            try {
              await global.sendNotification(
                email, // must be email
                {
                  id: notificationId,
                  user_id: card.data.created_by,
                  type: "ticket_moved_to_inreview",
                  title: "Ticket Moved to In Review",
                  message: `#${card.data.bug_id} from ${card.data.gameName} was moved to In Review by ${username}`,
                  context: {
                    ticket_id: card.data.id,
                    game_id: card.data.game_id,
                    action: "moved_to_in_review",
                  },
                  source_id: ws.email,
                  environment: "internal",
                  is_read: false,
                  created_at: currentTime
                },
                {
                  shouldNotifySelf: false
                }
              );
            } catch (err) {
              console.error("❌ WS notification error:", err);
            }
          } else {
            console.warn("⚠️ global.sendNotification not available");
          }
        }
      }


      broadcast(ws, "CARD_UPDATED", card);
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Update failed" })); }
  }


  async function handleDeleteCard(ws, payload) {
    try {
       const pool = getDB();
const db = await pool.getConnection();
      const { id, deleted_comments } = payload;

      if (!id || !deleted_comments) {
        return ws.send(JSON.stringify({
          type: "ERROR",
          message: "Missing card id or deleted comments"
        }));
      }

      // 1️⃣ Delete ticket/comment
      const data = await deleteTicket({
        id,
        userId: ws.userId,
        deleted_comments
      });

      // 2️⃣ Get game_id from bug_details
      const [bugRows] = await db.execute(
        `SELECT game_id,name FROM bug_details WHERE id = ?`,
        [id]
      );

      if (!bugRows.length) return;
      const gameId = bugRows[0].game_id;
      const bugName = bugRows[0].name;

      // 3️⃣ Get game name + version
      const [gameRows] = await db.execute(
        `SELECT name, current_verson as current_version FROM gameinfodetails WHERE id = ?`,
        [gameId]
      );

      if (!gameRows.length) return;

      const gameName = gameRows[0].name;
      const gameVersion = gameRows[0].current_version;

      // 4️⃣ Get user details
      const username = await getUserNameById(ws.userId);
      const email = ws.email;

      // 5️⃣ Insert activity log
      const insertQuery = `
      INSERT INTO builduser
      (gamename,bug_name, username, email, gameversion, command, useraction, lastupdate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

      await db.execute(insertQuery, [
        gameName,
        bugName,
        username,
        email,
        gameVersion,
        deleted_comments, // command
        "Bug Deleted",    // useraction
        getCurrentISTForMySQL()
      ]);

      // 6️⃣ Broadcast websocket event
      broadcast(ws, "CARD_DELETED", {
        id,
        message: data.message,
        assignee_dropdown: data.assignee_dropdown,
        reported_by_dropdown: data.reported_by_dropdown,
        iteration_dropdown: data.iteration_dropdown,
        platform_dropdown: data.platform_dropdown,
        environment_dropdown: data.environment_dropdown
      });

    } catch (err) {
      console.error(err);
      ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
    }
  }

  async function handleMoveCard(ws, payload) {
    try {
      const { id, status_id } = payload;
      if (!id || status_id === undefined) return ws.send(JSON.stringify({ type: "ERROR", message: "Missing move data" }));

      const card = await moveTicket({ id, status_id, userId: ws.userId });
      broadcast(ws, "CARD_MOVED", card);
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Move failed" })); }
  }

  async function handleGetAllTickets(ws, payload) {
    try {
      const { game_id, search, severity, assignee_ids, reported_by_ids } = payload;
      if (!game_id) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "game_id is required" }));
      }
      const tickets = await getAllTickets(payload);
      ws.send(JSON.stringify({ type: "ALL_TICKETS", data: tickets }));
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch tickets" })); }
  }

  async function handleGetUserTickets(ws) {
    try {
      const tickets = await getTicketsByUser(ws.userId);
      ws.send(JSON.stringify({ type: "USER_TICKETS", payload: tickets }));
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch tickets" })); }
  }

  async function handleDropdownRequest(ws, payload) {
    try {
      const { dropdown_type, game_id } = payload; // "assignee" | "reported_by"

      if (!dropdown_type) {
        throw new Error("dropdown_type is required");
      }

      const dropdown = await getDropdownList(dropdown_type, game_id, ws.userId);

      ws.send(
        JSON.stringify({
          type: "DROPDOWN_LIST",
          dropdownType: dropdown_type,
          payload: dropdown,
        })
      );
    } catch (err) {
      console.error("Dropdown error:", err);
      ws.send(
        JSON.stringify({
          type: "ERROR",
          message: "Failed to fetch dropdown data",
        })
      );
    }
  }

  async function handleUploadFiles(ws, payload) {
    try {
      const { bug_id, attachments, new_files } = payload;

      if (!bug_id) {
        throw new Error("bug_id required");
      }

      const response = await saveBugAttachments(
        bug_id,
        attachments,
        ws.userId,
        new_files   // ✅ PASS NEW FILES
      );


      // 🔁 broadcast to all clients
      broadcast(ws, "FILES_UPLOADED", response);

    } catch (err) {
      console.error("Upload files error:", err);

      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to save attachments"
      }));
    }
  }

  async function handleRemoveFiles(ws, payload) {
    try {
      const { bug_id, attachments, removed_files } = payload;

      if (!bug_id) {
        throw new Error("bug_id required");
      }

      const response = await removeBugAttachments(
        bug_id,
        attachments,
        ws.userId,
        removed_files   // ✅ pass removed files
      );

      // 🔁 broadcast to all clients
      broadcast(ws, "FILES_REMOVED", response);

    } catch (err) {
      console.error("Remove files error:", err);

      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to remove attachments"
      }));
    }
  }

  async function handleUpdateDescription(ws, payload) {
    try {
      const { bug_id, description } = payload;

      if (!bug_id) {
        throw new Error("bug_id required");
      }

      const response = await updateBugDescription(
        bug_id,
        description,
        ws.userId
      );

      // 🔁 broadcast to all clients
      broadcast(ws, "DESCRIPTION_UPDATED", response);

    } catch (err) {
      console.error("Update description error:", err);

      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to update description"
      }));
    }
  }
  async function handleGetActivityLogs(ws, payload) {
    try {
      const { bug_id } = payload;

      if (!bug_id) {
        return ws.send(JSON.stringify({
          type: "ERROR",
          message: "bug_id is required"
        }));
      }

      const logs = await getActivityLogs(bug_id);

      ws.send(JSON.stringify({
        type: "ACTIVITY_LOGS",
        payload: logs
      }));

    } catch (err) {
      console.error("Get activity logs error:", err);
      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to fetch activity logs"
      }));
    }
  }

  async function handleAddComment(ws, payload) {
    try {
      const { bug_id, attachments = null, comment, mentioned_user_ids = [] } = payload;

      if (!bug_id || !comment) {
        return ws.send(JSON.stringify({
          type: "ERROR",
          message: "bug_id and comment required"
        }));
      }
      const response = await AddComments(
        bug_id,
        attachments,
        comment,
        ws.userId
      );


      if (global.sendNotification && mentioned_user_ids.length > 0) {
        const currentTime = getCurrentISTForMySQL();
        try {
          for (const userId of mentioned_user_ids) {

            // ❌ skip self mention
            if (String(userId) === String(ws.userId)) continue;



            const email = await getEmailByUserId(userId);
            const mentionedBy = await getUserNameById(ws.userId);

            if (!email) continue;

            const notificationId = await createNotification({
              userId: email,
              type: "mention",
              title: "Mentioned in Comment",
              message: `You have been mentioned ticket #${response.bug_details_id} by ${mentionedBy}`,
              context: {
                ticket_id: bug_id,
                game_id: response.game_id,
                action: "mentioned_in_comment",
              },
              sourceId: ws.email,
            });

            await global.sendNotification(
              email,
              {
                id: notificationId || Date.now(),
                user_id: userId,
                type: "mention",

                // ✅ YOUR STRUCTURE
                title: "Mentioned in Comment",
                message: `You have been mentioned in Bug #${response.bug_details_id} by ${mentionedBy}`,

                context: {
                  ticket_id: bug_id,
                  game_id: response.game_id,
                  action: "mentioned_in_comment",
                },

                source_id: ws.email,
                environment: "internal",
                is_read: false,
                created_at: currentTime
              },
              {
                shouldNotifySelf: false
              }
            );
          }
        } catch (err) {
          console.error("❌ Mention notification error:", err);
        }
      } else {
        console.warn("⚠️ global.sendNotification not available");
      }

      // 🔁 broadcast to all clients
      broadcast(ws, "COMMENT_ADDED", response);
    } catch (err) {
      console.error("Add comment error:", err);
      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to add comment"
      }));
    }
  }

  async function handleUpdateComment(ws, payload) {
    try {
      const { comment_id, comment, mentioned_user_ids = [] } = payload;
      if (!comment_id || !comment) {
        return ws.send(JSON.stringify({
          type: "ERROR",
          message: "comment_id and comment required"
        }));
      }
      const response = await updateComment(
        comment_id,
        comment,
        ws.userId
      );

      if (global.sendNotification && mentioned_user_ids.length > 0) {
        try {
          for (const userId of mentioned_user_ids) {

            if (String(userId) === String(ws.userId)) continue;

            const email = await getEmailByUserId(userId);
            const mentionedBy = await getUserNameById(ws.userId);

            if (!email) continue;

            await global.sendNotification(
              email,
              {
                id: Date.now(),
                user_id: userId,
                type: "mention",

                title: "Mentioned in Comment",
                message: `You have been mentioned in a comment by ${mentionedBy}`,

                context: {
                  comment_id: comment_id,
                  action: "mentioned_in_comment",
                },

                source_id: ws.email,
                environment: "internal",
                is_read: false,
                created_at: new Date().toISOString()
              },
              {
                shouldNotifySelf: false
              }
            );
          }
        } catch (err) {
          console.error("❌ Mention notification error:", err);
        }
      }

      // 🔁 broadcast to all clients
      broadcast(ws, "COMMENT_UPDATED", response);
    } catch (err) {
      console.error("Update comment error:", err);
      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to update comment"
      }));
    }
  }
  async function handleDeleteComment(ws, payload) {
    try {
      const { comment_id } = payload;
      if (!comment_id) {
        return ws.send(JSON.stringify({
          type: "ERROR",
          message: "comment_id required"
        }));
      }
      const response = await deleteComment(
        comment_id,
        ws.userId
      );
      // 🔁 broadcast to all clients
      broadcast(ws, "COMMENT_DELETED", response);
    } catch (err) {
      console.error("Delete comment error:", err);
      ws.send(JSON.stringify({
        type: "ERROR",
        message: "Failed to delete comment"
      }));
    }
  }
  async function statusCountByGamedata(ws, payload) {
    try {
      const { game_id } = payload;
      if (!game_id) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "game_id is required" }));
      }
      const data = await statusCountByGame(game_id);
      ws.send(JSON.stringify({ type: "DASHBOARD_STATUS_COUNT", data }));
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch status count" })); }
  }
  async function HighSeverityBugs(ws, payload) {
    try {
      const { game_id, type } = payload;
      if (!game_id || !type) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "game_id and type are required" }));
      }
      const data = await dashboardHighSeverityBugs(game_id, type);
      console.log(data, "db data");

      ws.send(JSON.stringify({ type: "DASHBOARD_HIGH_SEVERITY_BUGS", data }));
    } catch (err) { console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch high severity bugs" })); }
  }
  async function openBugsByAssignees(ws, payload) {
    try {
      const { game_id } = payload;
      if (!game_id) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "game_id is required" }));
      }
      const data = await openBugsByAssignee(game_id);
      ws.send(JSON.stringify({ type: "DASHBOARD_OPEN_BUGS_BY_ASSIGNEES", data }));
    } catch (err) {
      console.error(err); ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch open bugs by assignees" }));
    }

  }
  async function bugByStatus(ws, payload) {
    try {
      const { game_id } = payload;
      if (!game_id) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "game_id is required" }));
      }
      const data = await bugsByStatus(game_id);
      ws.send(JSON.stringify({ type: "DASHBOARD_BUGS_BY_STATUS", data }));
    } catch (err) {
      console.error(err);
      ws.send(JSON.stringify({ type: "ERROR", message: "Failed to fetch bugs by status" }));
    }
  }

  return ws;
};



