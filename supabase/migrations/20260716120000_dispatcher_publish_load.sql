-- Dispatchers are an operating role: they run their organization's work end to
-- end (publish, assign, coordinate, close). The application role matrix
-- (packages/contracts/src/permissions.ts) grants dispatcher `publish_load`;
-- this replaces org_role_can so row-level security agrees. Without it the
-- database would refuse a load_postings write the application authorizes.
--
-- Deliberately unchanged for dispatcher: `manage_members` (organization
-- ownership) and `manage_billing` (money) stay with owners, admins, and
-- billing. Every other role's action set is byte-for-byte as it was.
--
-- Consequence worth naming: `private_network_owner_write` on
-- public.private_network_relationships admits `manage_members` OR
-- `publish_load` (org_role_can uses array overlap), so dispatchers gain
-- partner-relationship writes there — the same access landing_manager already
-- holds through publish_load. That is consistent with the operating role.
--
-- Additive and idempotent: create or replace only, no data change, no grant
-- change, no policy change.

create or replace function public.org_role_can(p_company_id uuid, p_actions text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with role_actions as (
    select case memberships.role
      when 'owner' then array['view_network','manage_members','manage_billing','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
      when 'admin' then array['view_network','manage_members','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
      when 'dispatcher' then array['view_network','manage_trucks','manage_drivers','publish_load','assign_capacity','request_assignment','progress_trip','send_operational_notice','view_private_location']
      when 'driver' then array['view_network','request_assignment','progress_trip','view_private_location']
      when 'fleet_manager' then array['view_network','manage_trucks','manage_drivers','assign_capacity','request_assignment','progress_trip','send_operational_notice','view_private_location']
      when 'landing_manager' then array['view_network','publish_load','assign_capacity','manage_landing','send_operational_notice','view_private_location']
      when 'destination_manager' then array['view_network','manage_destination','send_operational_notice','view_private_location']
      when 'billing' then array['view_network','manage_billing']
      else array['view_network']
    end as actions
    from public.organization_memberships memberships
    where memberships.company_id = p_company_id
      and memberships.profile_id = public.current_profile_id()
      and memberships.status = 'active'
  )
  select exists (select 1 from role_actions where actions && p_actions)
$$;

revoke execute on function public.org_role_can(uuid, text[]) from public;
grant execute on function public.org_role_can(uuid, text[]) to authenticated, service_role;
