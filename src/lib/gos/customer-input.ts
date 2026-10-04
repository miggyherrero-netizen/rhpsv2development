import { z } from "zod";
import { CAME_FROM } from "@/lib/gos/customers";

export const addCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    phone: z.string().trim().max(30).regex(/^[0-9+\-() ]*$/),
    area: z.string().trim().max(60),
    cameFrom: z.enum(CAME_FROM),
    adChoice: z.enum(["ad", "unknown", "none"]),
    adId: z.string().uuid().nullable(),
    note: z.string().max(500),
  })
  .refine((v) => v.adChoice !== "ad" || v.adId !== null, { path: ["adId"] });

export type AddCustomerInput = z.infer<typeof addCustomerSchema>;

export const lostSchema = z.object({ reason: z.string().trim().min(1).max(60) });
