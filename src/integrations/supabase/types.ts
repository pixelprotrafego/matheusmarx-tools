export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ip_rate_limits: {
        Row: {
          bucket: string
          count: number
          ip: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          ip: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          ip?: string
          window_start?: string
        }
        Relationships: []
      }
      telegram_pending_actions: {
        Row: {
          chat_id: number
          created_at: string
          file_id: string
          filename: string
          mime: string
          op: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          file_id: string
          filename?: string
          mime?: string
          op: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          file_id?: string
          filename?: string
          mime?: string
          op?: string
        }
        Relationships: []
      }
      telegram_pending_files: {
        Row: {
          chat_id: number
          created_at: string
          file_id: string
          filename: string
          key: string
          mime: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          file_id: string
          filename?: string
          key: string
          mime?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          file_id?: string
          filename?: string
          key?: string
          mime?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      check_and_increment_ip_limit: {
        Args: {
          _bucket: string
          _daily: number
          _hourly: number
          _ip: string
        }
        Returns: Json
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
