export type TransactionType = "income" | "expense";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  source_destination: string;
  description: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface Settings {
  opening_balance: number;
  currency: string;
  app_name: string;
  theme?: "light" | "dark" | "system";
}

export interface DashboardData {
  balance: number;
  opening_balance: number;
  income_today: number;
  expense_today: number;
  expense_month: number;
  recent_transactions: Transaction[];
  settings: Settings;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}
