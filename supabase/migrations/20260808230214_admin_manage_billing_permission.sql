-- Organization admins already own membership, publishing, and audit decisions
-- in the application matrix. The current commercial contract also names
-- owners, admins, and billing members as the roles that manage host billing.
-- Replace the shared authorization helper so RLS agrees with that exact
-- least-privilege matrix; every other role remains unchanged.
--
-- Additive and idempotent: function body plus the existing server-only ACL;
-- no data or policy rewrite.

create or replace function public.org_role_can(p_company_id uuid, p_actions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with role_actions as (
    select case memberships.role
      when 'owner' then array['view_network','manage_members','manage_billing','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
      when 'admin' then array['view_network','manage_members','manage_billing','manage_trucks','manage_drivers','publish_load','assign_capacity','manage_landing','manage_destination','request_assignment','progress_trip','send_operational_notice','view_private_location','view_audit_log']
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

-- The application never evaluates relational RLS as anon/authenticated; it
-- reads and writes the canonical operating_state row through service_role.
-- Preserve the service-role-only boundary established by
-- 20260726090000_revoke_public_relational_grants.sql instead of reviving a
-- direct PostgREST execution surface on this SECURITY DEFINER helper.
revoke execute on function public.org_role_can(uuid, text[]) from public, anon, authenticated;
grant execute on function public.org_role_can(uuid, text[]) to service_role;
