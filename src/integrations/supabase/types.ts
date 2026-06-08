export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_tokens: {
        Row: {
          action: string
          contact_id: string | null
          created_at: string
          expires_at: string
          id: string
          job_id: string | null
          payload: Json
          token_hash: string
          used_at: string | null
        }
        Insert: {
          action: string
          contact_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          job_id?: string | null
          payload?: Json
          token_hash: string
          used_at?: string | null
        }
        Update: {
          action?: string
          contact_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string | null
          payload?: Json
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      app_sessions: {
        Row: {
          app_user_id: string
          expires_at: string
          id: string
          ip: unknown
          issued_at: string
          revoked_at: string | null
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          app_user_id: string
          expires_at: string
          id?: string
          ip?: unknown
          issued_at?: string
          revoked_at?: string | null
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          app_user_id?: string
          expires_at?: string
          id?: string
          ip?: unknown
          issued_at?: string
          revoked_at?: string | null
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_sessions_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          last_seen_at: string | null
          last_verified_at: string | null
          location_id: string
          name: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          uptiq_user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          last_seen_at?: string | null
          last_verified_at?: string | null
          location_id: string
          name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          uptiq_user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          last_seen_at?: string | null
          last_verified_at?: string | null
          location_id?: string
          name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          uptiq_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_users_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          brand_font: string
          brand_logo_url: string | null
          brand_primary_color: string
          brand_secondary_color: string
          check_in_send_time: string
          check_in_weekdays: number[]
          created_at: string
          default_supply_house_contact_id: string | null
          id: string
          inspection_reminder_time: string
          inspections_calendar_id: string | null
          location_id: string
          office_contact_id: string | null
          office_email: string | null
          office_phone: string | null
          owner_contact_id: string | null
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          parts_cost_ceiling: number
          review_request_delay_days: number
          supply_house_pickup_time: string | null
          updated_at: string
          weekly_report_day: number
          weekly_report_time: string
        }
        Insert: {
          brand_font?: string
          brand_logo_url?: string | null
          brand_primary_color?: string
          brand_secondary_color?: string
          check_in_send_time?: string
          check_in_weekdays?: number[]
          created_at?: string
          default_supply_house_contact_id?: string | null
          id?: string
          inspection_reminder_time?: string
          inspections_calendar_id?: string | null
          location_id: string
          office_contact_id?: string | null
          office_email?: string | null
          office_phone?: string | null
          owner_contact_id?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          parts_cost_ceiling?: number
          review_request_delay_days?: number
          supply_house_pickup_time?: string | null
          updated_at?: string
          weekly_report_day?: number
          weekly_report_time?: string
        }
        Update: {
          brand_font?: string
          brand_logo_url?: string | null
          brand_primary_color?: string
          brand_secondary_color?: string
          check_in_send_time?: string
          check_in_weekdays?: number[]
          created_at?: string
          default_supply_house_contact_id?: string | null
          id?: string
          inspection_reminder_time?: string
          inspections_calendar_id?: string | null
          location_id?: string
          office_contact_id?: string | null
          office_email?: string | null
          office_phone?: string | null
          owner_contact_id?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          parts_cost_ceiling?: number
          review_request_delay_days?: number
          supply_house_pickup_time?: string | null
          updated_at?: string
          weekly_report_day?: number
          weekly_report_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_default_supply_house_contact_id_fkey"
            columns: ["default_supply_house_contact_id"]
            isOneToOne: false
            referencedRelation: "supply_house_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          location_id: string
          name: string
          phone: string | null
          role: string | null
          updated_at: string
          uptiq_contact_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          location_id: string
          name: string
          phone?: string | null
          role?: string | null
          updated_at?: string
          uptiq_contact_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string
          name?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
          uptiq_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          created_at: string
          crew_contact_id: string
          field_purchase_amount: number | null
          field_purchase_description: string | null
          field_purchase_vendor: string | null
          hours_worked: number | null
          id: string
          inspection_requested: boolean | null
          issues: string | null
          job_id: string
          job_site_photo_urls: string[] | null
          log_date: string
          parts_list: string | null
          parts_photo_url: string | null
          parts_source: string | null
          receipt_photo_url: string | null
          state_id: string | null
          state_progress_pct: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          crew_contact_id: string
          field_purchase_amount?: number | null
          field_purchase_description?: string | null
          field_purchase_vendor?: string | null
          hours_worked?: number | null
          id?: string
          inspection_requested?: boolean | null
          issues?: string | null
          job_id: string
          job_site_photo_urls?: string[] | null
          log_date: string
          parts_list?: string | null
          parts_photo_url?: string | null
          parts_source?: string | null
          receipt_photo_url?: string | null
          state_id?: string | null
          state_progress_pct?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          crew_contact_id?: string
          field_purchase_amount?: number | null
          field_purchase_description?: string | null
          field_purchase_vendor?: string | null
          hours_worked?: number | null
          id?: string
          inspection_requested?: boolean | null
          issues?: string | null
          job_id?: string
          job_site_photo_urls?: string[] | null
          log_date?: string
          parts_list?: string | null
          parts_photo_url?: string | null
          parts_source?: string | null
          receipt_photo_url?: string | null
          state_id?: string | null
          state_progress_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_crew_contact_id_fkey"
            columns: ["crew_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "job_states"
            referencedColumns: ["id"]
          },
        ]
      }
      event_log: {
        Row: {
          actor_app_user_id: string | null
          actor_contact_id: string | null
          created_at: string
          dedupe_key: string | null
          error: string | null
          id: string
          kind: string
          location_id: string | null
          payload: Json
          result: Json | null
          source: string
          status: string
        }
        Insert: {
          actor_app_user_id?: string | null
          actor_contact_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          id?: string
          kind: string
          location_id?: string | null
          payload?: Json
          result?: Json | null
          source: string
          status?: string
        }
        Update: {
          actor_app_user_id?: string | null
          actor_contact_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          id?: string
          kind?: string
          location_id?: string | null
          payload?: Json
          result?: Json | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_log_actor_app_user_id_fkey"
            columns: ["actor_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_log_actor_contact_id_fkey"
            columns: ["actor_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_crew: {
        Row: {
          assigned_at: string
          contact_id: string
          is_lead: boolean
          job_id: string
        }
        Insert: {
          assigned_at?: string
          contact_id: string
          is_lead?: boolean
          job_id: string
        }
        Update: {
          assigned_at?: string
          contact_id?: string
          is_lead?: boolean
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_crew_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_crew_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_customers: {
        Row: {
          contact_id: string
          is_primary: boolean
          job_id: string
        }
        Insert: {
          contact_id: string
          is_primary?: boolean
          job_id: string
        }
        Update: {
          contact_id?: string
          is_primary?: boolean
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_customers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_customers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_expenses: {
        Row: {
          amount: number
          created_at: string
          daily_log_id: string | null
          description: string | null
          id: string
          job_id: string
          kind: string
          parts_photo_url: string | null
          purchase_order_id: string | null
          receipt_url: string | null
          recorded_by_contact_id: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          daily_log_id?: string | null
          description?: string | null
          id?: string
          job_id: string
          kind: string
          parts_photo_url?: string | null
          purchase_order_id?: string | null
          receipt_url?: string | null
          recorded_by_contact_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          daily_log_id?: string | null
          description?: string | null
          id?: string
          job_id?: string
          kind?: string
          parts_photo_url?: string | null
          purchase_order_id?: string | null
          receipt_url?: string | null
          recorded_by_contact_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_expenses_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_recorded_by_contact_id_fkey"
            columns: ["recorded_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_state_sets: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          location_id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          location_id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          location_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_state_sets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_state_transitions: {
        Row: {
          conditions: Json
          created_at: string
          from_state_id: string
          id: string
          state_set_id: string
          to_state_id: string
          trigger: string
        }
        Insert: {
          conditions?: Json
          created_at?: string
          from_state_id: string
          id?: string
          state_set_id: string
          to_state_id: string
          trigger: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          from_state_id?: string
          id?: string
          state_set_id?: string
          to_state_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_state_transitions_from_state_id_fkey"
            columns: ["from_state_id"]
            isOneToOne: false
            referencedRelation: "job_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_state_transitions_state_set_id_fkey"
            columns: ["state_set_id"]
            isOneToOne: false
            referencedRelation: "job_state_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_state_transitions_to_state_id_fkey"
            columns: ["to_state_id"]
            isOneToOne: false
            referencedRelation: "job_states"
            referencedColumns: ["id"]
          },
        ]
      }
      job_states: {
        Row: {
          active: boolean
          allow_check_ins: boolean
          color: string
          created_at: string
          id: string
          is_billing: boolean
          is_inspection: boolean
          is_terminal: boolean
          is_walkthrough: boolean
          label: string
          slug: string
          sort_order: number
          state_set_id: string
        }
        Insert: {
          active?: boolean
          allow_check_ins?: boolean
          color?: string
          created_at?: string
          id?: string
          is_billing?: boolean
          is_inspection?: boolean
          is_terminal?: boolean
          is_walkthrough?: boolean
          label: string
          slug: string
          sort_order?: number
          state_set_id: string
        }
        Update: {
          active?: boolean
          allow_check_ins?: boolean
          color?: string
          created_at?: string
          id?: string
          is_billing?: boolean
          is_inspection?: boolean
          is_terminal?: boolean
          is_walkthrough?: boolean
          label?: string
          slug?: string
          sort_order?: number
          state_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_states_state_set_id_fkey"
            columns: ["state_set_id"]
            isOneToOne: false
            referencedRelation: "job_state_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          active: boolean
          address: string
          completion_report: Json | null
          created_at: string
          current_state_id: string | null
          id: string
          inspection_date: string | null
          job_completion_pct: number
          latest_po: string | null
          location_id: string
          notes: string | null
          original_estimate: number | null
          paid_at: string | null
          paid_by_app_user_id: string | null
          paid_source: string | null
          payment_event_id: string | null
          payment_notes: string | null
          invoice_id: string | null
          invoice_number: string | null
          scope_of_work: string | null
          start_date: string | null
          state_progress_pct: number
          state_set_id: string
          total_expenses: number
          total_field_purchase_expenses: number
          total_hours: number
          total_po_expenses: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          completion_report?: Json | null
          created_at?: string
          current_state_id?: string | null
          id?: string
          inspection_date?: string | null
          job_completion_pct?: number
          latest_po?: string | null
          location_id: string
          notes?: string | null
          original_estimate?: number | null
          paid_at?: string | null
          paid_by_app_user_id?: string | null
          paid_source?: string | null
          payment_event_id?: string | null
          payment_notes?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          scope_of_work?: string | null
          start_date?: string | null
          state_progress_pct?: number
          state_set_id: string
          total_expenses?: number
          total_field_purchase_expenses?: number
          total_hours?: number
          total_po_expenses?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          completion_report?: Json | null
          created_at?: string
          current_state_id?: string | null
          id?: string
          inspection_date?: string | null
          job_completion_pct?: number
          latest_po?: string | null
          location_id?: string
          notes?: string | null
          original_estimate?: number | null
          paid_at?: string | null
          paid_by_app_user_id?: string | null
          paid_source?: string | null
          payment_event_id?: string | null
          payment_notes?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          scope_of_work?: string | null
          start_date?: string | null
          state_progress_pct?: number
          state_set_id?: string
          total_expenses?: number
          total_field_purchase_expenses?: number
          total_hours?: number
          total_po_expenses?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_current_state_id_fkey"
            columns: ["current_state_id"]
            isOneToOne: false
            referencedRelation: "job_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_state_set_id_fkey"
            columns: ["state_set_id"]
            isOneToOne: false
            referencedRelation: "job_state_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          company_name: string
          created_at: string
          id: string
          timezone: string
          updated_at: string
          uptiq_company_id: string | null
          uptiq_location_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
          timezone?: string
          updated_at?: string
          uptiq_company_id?: string | null
          uptiq_location_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
          timezone?: string
          updated_at?: string
          uptiq_company_id?: string | null
          uptiq_location_id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by_contact_id: string | null
          description: string | null
          estimated_amount: number | null
          final_amount: number | null
          id: string
          job_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["po_status"]
          supply_house_id: string | null
          updated_at: string
          valued_at: string | null
          valued_by_app_user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_contact_id?: string | null
          description?: string | null
          estimated_amount?: number | null
          final_amount?: number | null
          id?: string
          job_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supply_house_id?: string | null
          updated_at?: string
          valued_at?: string | null
          valued_by_app_user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_contact_id?: string | null
          description?: string | null
          estimated_amount?: number | null
          final_amount?: number | null
          id?: string
          job_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supply_house_id?: string | null
          updated_at?: string
          valued_at?: string | null
          valued_by_app_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_contact_id_fkey"
            columns: ["created_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supply_house_id_fkey"
            columns: ["supply_house_id"]
            isOneToOne: false
            referencedRelation: "supply_house_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_valued_by_app_user_id_fkey"
            columns: ["valued_by_app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_notifications: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notif_channel"]
          created_at: string
          dedupe_key: string | null
          id: string
          job_id: string | null
          last_error: string | null
          location_id: string
          payload: Json
          recipient: string
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notif_status"]
          template_key: string
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["notif_channel"]
          created_at?: string
          dedupe_key?: string | null
          id?: string
          job_id?: string | null
          last_error?: string | null
          location_id: string
          payload?: Json
          recipient: string
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notif_status"]
          template_key: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notif_channel"]
          created_at?: string
          dedupe_key?: string | null
          id?: string
          job_id?: string | null
          last_error?: string | null
          location_id?: string
          payload?: Json
          recipient?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notif_status"]
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_notifications_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_house_contacts: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          location_id: string
          name: string
          phone: string | null
          rep_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          location_id: string
          name: string
          phone?: string | null
          rep_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string
          name?: string
          phone?: string | null
          rep_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_house_contacts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: { _email: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "owner_admin"
        | "office_manager"
        | "crew"
        | "viewer"
        | "support_admin"
      notif_channel: "sms" | "email" | "task" | "tag" | "webhook"
      notif_status: "pending" | "sent" | "failed" | "cancelled"
      po_status: "draft" | "sent" | "pending_value" | "valued" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "owner_admin",
        "office_manager",
        "crew",
        "viewer",
        "support_admin",
      ],
      notif_channel: ["sms", "email", "task", "tag", "webhook"],
      notif_status: ["pending", "sent", "failed", "cancelled"],
      po_status: ["draft", "sent", "pending_value", "valued", "cancelled"],
    },
  },
} as const
