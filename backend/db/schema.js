const { pgTable, serial, text, timestamp } = require('drizzle-orm/pg-core')

exports.waitlist = pgTable('waitlist', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  lang: text('lang'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
