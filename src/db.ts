import { PrismaClient } from "@prisma/client";
import { broadcastEvent } from "./socket.js";

export const prisma = new PrismaClient();

prisma.$use(async (params, next) => {
  const result = await next(params);
  
  const mutationActions = ['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany'];
  if (mutationActions.includes(params.action)) {
    setTimeout(() => {
      try {
        broadcastEvent("GLOBAL_DATA_UPDATED", { model: params.model, action: params.action });
      } catch (e) {}
    }, 0);
  }
  
  return result;
});