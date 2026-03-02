export interface Order {
  id: string;
  customer_name: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  total: number;
  created_at: string;
  updated_at: string;
}

export const STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export const RANDOM_NAMES = [
  "Alice Johnson",
  "Bob Smith",
  "Carol White",
  "Dave Brown",
  "Eve Davis",
  "Frank Miller",
  "Grace Wilson",
  "Henry Moore",
  "Iris Taylor",
  "Jack Anderson",
];
