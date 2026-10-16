// routes/bug.routes.js
import express from "express";
import { getBugListApi, getSingleBugApi, getBugTrackingListApi, isBugApi } from "../controller/bugController.js";
import { getDropdownListAPI } from "../controller/commonController.js";
import s3UploadRoutes from "./s3Upload.routes.js";

const bugRouter = express.Router();

bugRouter.get("/bugList", getBugListApi);
bugRouter.get("/commonDropdownList", getDropdownListAPI);
bugRouter.use("/s3", s3UploadRoutes);
bugRouter.get("/bugs/:id",getSingleBugApi);
bugRouter.get("/checkBug",isBugApi)
bugRouter.get("/bugTrackingList", getBugTrackingListApi);
export default bugRouter;