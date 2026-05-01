/**
 * Internal case bundle schema — after ingestion and before L1/L2.
 * Maps from SM form fields + extracted text + video transcript.
 */

export interface CaseMetadata {
  case_id: string;
  year: string;
  nomination_id: string;
  block_id: string;
  project_id?: string;
  project_name?: string;
  project_date_from?: string;
  project_date_to?: string;
  project_size_id?: string;
}

/** Text fields from the submission form (SM-style). */
export interface CaseTextFields {
  project_info?: string;
  project_product?: string;
  project_auditory?: string;
  project_insight?: string;
  project_targets?: string;
  project_task?: string;
  project_strategy?: string;
  project_channels?: string;
  project_realisation?: string;
  project_results?: string;
  project_start_info?: string;
  project_additional_factors?: string;
}

/** Extracted content from a document with provenance. */
export interface ExtractedSegment {
  text: string;
  source: string;
  page_or_slide?: number;
  timestamp?: string;
  /** DB id (public.evidence) once persisted — short id for citation in prompts. */
  evidence_id?: string;
  /** Short alias used in prompts (e.g. "E1", "E2") that maps to evidence_id. */
  cite_key?: string;
  /** Storage path if this segment came from an uploaded file. */
  storage_path?: string;
  /** Evidence kind for the DB row. */
  kind?: "pdf_page" | "video_frame" | "video_clip" | "audio_quote" | "text_field" | "extracted_text";
}

/** Video transcript segment. */
export interface TranscriptSegment {
  text: string;
  start_sec?: number;
  end_sec?: number;
  confidence?: number;
}

/** Case bundle — input to Evidence Index and L1/L2. */
export interface CaseBundle {
  metadata: CaseMetadata;
  text_fields: CaseTextFields;
  extracted_text: ExtractedSegment[];
  transcript?: TranscriptSegment[];
  video_url?: string;
  redacted?: boolean;
  config_hash?: string;
}
