export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      library_entries: {
        Row: {
          created_at: string;
          finished_at: string | null;
          id: string;
          is_favorite: boolean;
          mal_id: number;
          media_format: string;
          media_image_url: string | null;
          media_is_adult: boolean;
          media_kind: Database['public']['Enums']['media_kind'];
          media_title: string;
          media_total_units: number | null;
          notes: string | null;
          progress: number;
          score: number | null;
          started_at: string | null;
          status: Database['public']['Enums']['library_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          is_favorite?: boolean;
          mal_id: number;
          media_format: string;
          media_image_url?: string | null;
          media_is_adult?: boolean;
          media_kind: Database['public']['Enums']['media_kind'];
          media_title: string;
          media_total_units?: number | null;
          notes?: string | null;
          progress?: number;
          score?: number | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['library_status'];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          is_favorite?: boolean;
          mal_id?: number;
          media_format?: string;
          media_image_url?: string | null;
          media_is_adult?: boolean;
          media_kind?: Database['public']['Enums']['media_kind'];
          media_title?: string;
          media_total_units?: number | null;
          notes?: string | null;
          progress?: number;
          score?: number | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['library_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          preferences: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          preferences?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          preferences?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [];
      };
      progress_events: {
        Row: {
          created_at: string;
          entry_id: string;
          from_progress: number;
          id: number;
          to_progress: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entry_id: string;
          from_progress: number;
          id?: never;
          to_progress: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          from_progress?: number;
          id?: never;
          to_progress?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'progress_events_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'library_entries';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      library_status: 'current' | 'planned' | 'completed' | 'paused' | 'dropped';
      media_kind: 'anime' | 'manga';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      library_status: ['current', 'planned', 'completed', 'paused', 'dropped'],
      media_kind: ['anime', 'manga'],
    },
  },
} as const;
