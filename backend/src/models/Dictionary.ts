// Dictionary model interface
export interface Dictionary {
  id: string;
  name: string;
  description?: string;
  version?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Dictionary entry interface
export interface DictionaryEntry {
  id: string;
  name: string;
  description: string;
  type: string;
  format?: string;
  required?: boolean;
  defaultValue?: any;
  examples?: string[];
  metadata?: Record<string, any>;
}