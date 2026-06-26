'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Ticket - the shared, server-persisted helpdesk ticket. Raw fields come from
 * the Spiceworks CSV; underscore-prefixed fields are derived by the SLA engine
 * at ingest time and stored so reads are cheap (no re-parsing per request).
 *
 * `ticketId` is the business key from the source system and is unique - this is
 * what enables true upsert sync across uploads and devices.
 */
const ticketSchema = new Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    summary: { type: String, default: 'N/A', trim: true },
    assignee: { type: String, default: 'N/A', trim: true, index: true },
    creator: { type: String, default: 'N/A', trim: true },
    organization: { type: String, default: 'N/A', trim: true },
    priority: { type: String, default: 'N/A', trim: true, index: true },
    category: { type: String, default: 'N/A', trim: true, index: true },
    status: { type: String, default: 'N/A', trim: true, index: true },

    // Original string fields (kept verbatim for display / re-derivation)
    created: { type: String, default: 'N/A' },
    closeTimeSecsRaw: { type: String, default: 'N/A' }, // source close_time_secs
    firstResponseSecsRaw: { type: String, default: 'N/A' }, // source first_response_secs

    // Derived (computed by slaEngine.deriveTicketFields). Column swap applied.
    date: { type: Date, default: null, index: true },
    frSecs: { type: Number, default: null }, // actual First Response seconds
    ctSecs: { type: Number, default: null }, // actual Close/Resolution seconds
    frPass: { type: Schema.Types.Mixed, default: 'pending' }, // true|false|'pending'|null
    ctPass: { type: Schema.Types.Mixed, default: 'pending' },

    // Bag for any extra CSV columns not explicitly modelled
    extra: { type: Map, of: String, default: {} },
  },
  { timestamps: true },
);

// Compound indexes for the common analytics queries
ticketSchema.index({ priority: 1, status: 1 });
ticketSchema.index({ date: -1 });
ticketSchema.index({ assignee: 1, status: 1 });

/** Map a stored document back into the plain shape the SLA engine expects. */
ticketSchema.methods.toEngineRecord = function toEngineRecord() {
  return {
    id: this.ticketId,
    ticketId: this.ticketId,
    summary: this.summary,
    assignee: this.assignee,
    creator: this.creator,
    organization: this.organization,
    priority: this.priority,
    category: this.category,
    status: this.status,
    created: this.created,
    close_time_secs: this.closeTimeSecsRaw,
    first_response_secs: this.firstResponseSecsRaw,
    _date: this.date,
    _frSecs: this.frSecs,
    _ctSecs: this.ctSecs,
    _frPass: this.frPass,
    _ctPass: this.ctPass,
  };
};

ticketSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
