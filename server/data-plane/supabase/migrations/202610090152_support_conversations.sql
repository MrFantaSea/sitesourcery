begin;

-- Existing correspondence remains purgeable; no regulatory case backfill.
alter table ss.support_messages
  add column command_id text check (command_id is null or command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  add column resolved_ticket boolean not null default false,
  add constraint support_message_command_actor check (command_id is null or author_user_id is not null);
create unique index support_message_actor_command on ss.support_messages(author_user_id,command_id)
  where command_id is not null;
alter table ss.support_tickets add constraint support_ticket_project_identity unique(organization_id,project_id,id);
alter table ss.support_messages add constraint support_message_exact_ticket
  foreign key(organization_id,project_id,ticket_id) references ss.support_tickets(organization_id,project_id,id) on delete cascade;
create index support_message_conversation_order on ss.support_messages(ticket_id,created_at desc,id desc);
create index support_ticket_customer_order on ss.support_tickets(organization_id,project_id,opened_by_user_id,created_at desc,id desc);

commit;
