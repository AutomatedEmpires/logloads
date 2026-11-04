-- =============================================================================
-- LogLoads normalized-v2 — 21 identity-claim edge cases and membership revocation (#112, database layer)
--
-- NON-ACTIVE PROTOTYPE TEST SUITE. Disposable PostgreSQL only. Run after
-- 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16. Wraps everything in BEGIN ... ROLLBACK.
--
-- Simulated claims (`request.jwt.claims`) prove layer 2 only: what marketplace.current_user_id() and RLS do with
-- claims the gateway already accepted. Signature, expiry and issuer checks at the gateway are stage 22
-- (tools/verify-clerk-supabase-auth.mjs --local-stack, locally signed tokens through PostgREST) and, with real
-- Clerk tokens, the same harness run live by the owner (docs/SECURITY.md §5.1).
--
-- Already covered elsewhere and not repeated: untrusted issuer, wrong audience, expired, missing exp, missing
-- role and anon role (04 §2a); invitation acceptance and reinstatement rules (17 B-1); LE-09 pinned audiences (17).
-- New here: audience arrays and a missing audience, nbf, non-numeric exp, role spoofing, blank and whitespace
-- subjects, issuer spelling, cross-issuer subjects, a disabled issuer, suspended and deactivated users, tenant
-- isolation for a valid token, and loss of access on the next statement after a membership is suspended or
-- removed, or its organization is suspended.
-- =============================================================================

begin;

create function pg_temp.claims(p_sub text, p_changes jsonb default '{}', p_drop text[] default '{}')
returns jsonb language sql stable as $$
  select (jsonb_build_object(
      'role', 'authenticated', 'iss', 'https://clerk.logloads.test', 'sub', p_sub, 'aud', 'logloads-app',
      'exp', extract(epoch from now())::bigint + 3600) || p_changes) - p_drop
$$;

-- Present claims as PostgREST does after verifying a token: the claims GUC plus the token's database role.
create function pg_temp.present(p_claims jsonb) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute 'set local role authenticated';
end
$$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end
$$;

create function pg_temp.as_harness() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST FAILED: %', p_label using errcode = 'P0001';
  end if;
  raise notice 'PASS: %', p_label;
end
$$;

create function pg_temp.fails(p_sql text, p_state text, p_reason text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text; v_constraint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
    if v_state = p_state and (coalesce(v_constraint, '') ~* p_reason or v_msg ~* p_reason) then
      raise notice 'PASS: % (% /%/)', p_label, v_state, p_reason;
      return;
    end if;
    raise exception 'TEST FAILED: % — expected % /%/, got % constraint=% message=%',
      p_label, p_state, p_reason, v_state, coalesce(v_constraint, '-'), v_msg using errcode = 'P0001';
  end;
  raise exception 'TEST FAILED: % — expected failure %, statement succeeded', p_label, p_state using errcode = 'P0001';
end
$$;

-- The security property for a malformed claim set is that it never resolves a user. Resolving NULL and
-- refusing with an error both satisfy it, so either passes; only a resolved user fails.
create function pg_temp.never_resolves(p_claims jsonb, p_label text) returns void language plpgsql as $$
declare v_user uuid; v_state text;
begin
  perform pg_temp.present(p_claims);
  begin
    v_user := marketplace.current_user_id();
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'PASS: % (refused with SQLSTATE %)', p_label, v_state;
    return;
  end;
  if v_user is not null then
    raise exception 'TEST FAILED: % — the claims resolved a user', p_label using errcode = 'P0001';
  end if;
  raise notice 'PASS: % (resolves NULL)', p_label;
end
$$;

create function pg_temp.resolved(p_claims jsonb) returns uuid language plpgsql as $$
begin
  perform pg_temp.present(p_claims);
  return marketplace.current_user_id();
end
$$;

-- Units the presented claims can read in an organization, through RLS.
create function pg_temp.units_visible(p_claims jsonb, p_org uuid) returns integer language plpgsql as $$
declare v_count integer;
begin
  perform pg_temp.present(p_claims);
  select count(*) into v_count from marketplace.equipment_units where org_id = p_org;
  return v_count;
end
$$;

-- Whether get_viewer_marketplace_access opens the organization for the presented claims.
create function pg_temp.viewer_opens(p_claims jsonb, p_org uuid) returns boolean language plpgsql as $$
begin
  perform pg_temp.present(p_claims);
  perform 1 from marketplace.get_viewer_marketplace_access(p_org);
  return found;
exception when insufficient_privilege then
  return false;
end
$$;

-- 18 (HF-18, PR #194) withholds EXECUTE from PUBLIC on functions this role creates. The helpers run after
-- SET ROLE authenticated / service_role, so they are granted explicitly (a no-op without 18).
grant execute on all functions in schema pg_temp to public;

insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled)
values ('https://clerk.logloads.test', 'Clerk Test', 'logloads-app', true),
       ('https://clerk-other.logloads.test', 'Another Clerk instance', 'logloads-app', true)
on conflict (issuer) do nothing;

do $$
declare
  c_iss constant text := 'https://clerk.logloads.test';
  c_other constant text := 'https://clerk-other.logloads.test';
  u_a uuid; u_b uuid; u_blank uuid;
  o_a uuid; o_b uuid; e_a uuid; e_b uuid; m_b uuid; m_again uuid;
  t_a jsonb; t_b jsonb; t_wrong jsonb;
  v_now bigint := extract(epoch from now())::bigint;
begin
  perform pg_temp.as_service();
  u_a := marketplace.sync_verified_identity(c_iss, 's21_a', 'S21 A', 'a@s21.test', true);
  u_b := marketplace.sync_verified_identity(c_iss, 's21_b', 'S21 B', 'b@s21.test', true);
  u_blank := marketplace.sync_verified_identity(c_iss, ' ', 'S21 Whitespace Subject', null, false);

  -- One claim set per person, reused unchanged below: the same "token" before and after each change.
  t_a := pg_temp.claims('s21_a');
  t_b := pg_temp.claims('s21_b');
  t_wrong := pg_temp.claims('s21_a', '{"aud":"some-other-app"}');

  -- -------------------------------------------------------------------------
  -- 1. Claim edge cases not covered by 04 §2a
  -- -------------------------------------------------------------------------
  perform pg_temp.ok(pg_temp.resolved(t_a) = u_a, 'baseline: a valid claim set resolves its own app_users row');
  perform pg_temp.ok(pg_temp.resolved(t_b) = u_b, 'baseline: a second person resolves their own row, not the first person''s');

  perform pg_temp.ok(pg_temp.resolved(pg_temp.claims('s21_a', '{"aud":["another-app","logloads-app"]}')) = u_a,
    'aud: an audience array that contains the pinned audience resolves');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"aud":["another-app"]}'),
    'aud: an audience array without the pinned audience');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', p_drop => array['aud']),
    'aud: no audience claim, for an issuer that pins one (LE-09)');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"aud":""}'), 'aud: an empty audience');

  perform pg_temp.never_resolves(pg_temp.claims('s21_a', jsonb_build_object('nbf', v_now + 300)),
    'nbf: a token that is not valid yet');
  perform pg_temp.ok(pg_temp.resolved(pg_temp.claims('s21_a', jsonb_build_object('nbf', v_now - 60))) = u_a,
    'nbf: a token already valid resolves');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"nbf":"soon"}'), 'nbf: a non-numeric nbf');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"exp":"never"}'), 'exp: a non-numeric exp');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', jsonb_build_object('exp', v_now)),
    'exp: a token expiring this second');

  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"role":"service_role"}'),
    'role: a Clerk claim set naming service_role (presented under the authenticated database role)');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"role":"Authenticated"}'),
    'role: the role claim is case-sensitive');

  perform pg_temp.never_resolves(pg_temp.claims(' '), 'sub: a whitespace-only subject never resolves, even when linked');
  perform pg_temp.never_resolves(pg_temp.claims(''), 'sub: an empty subject');
  perform pg_temp.never_resolves(pg_temp.claims('S21_A'), 'sub: the subject is case-sensitive');

  perform pg_temp.never_resolves(pg_temp.claims('s21_a', '{"iss":"https://clerk.logloads.test/"}'),
    'iss: the issuer must match exactly (a trailing slash is another issuer)');
  perform pg_temp.never_resolves(pg_temp.claims('s21_a', jsonb_build_object('iss', c_other)),
    'iss: a subject linked under one trusted issuer does not resolve under another trusted issuer');

  perform pg_temp.as_harness();
  update marketplace.trusted_identity_issuers set enabled = false where issuer = c_iss;
  perform pg_temp.never_resolves(t_a, 'issuer: disabling the issuer stops its tokens on the next statement');
  perform pg_temp.as_service();
  perform pg_temp.fails(format('select marketplace.sync_verified_identity(%L, %L, %L)', c_iss, 's21_new', 'S21 New'),
    '42501', 'untrusted identity issuer', 'issuer: a disabled issuer cannot link new identities');
  perform pg_temp.as_harness();
  update marketplace.trusted_identity_issuers set enabled = true where issuer = c_iss;
  perform pg_temp.ok(pg_temp.resolved(t_a) = u_a, 'issuer: re-enabling it restores the same token');

  perform pg_temp.as_harness();
  update marketplace.app_users set status = 'suspended' where id = u_a;
  perform pg_temp.never_resolves(t_a, 'user: a suspended user resolves NULL on the next statement');
  perform pg_temp.as_harness();
  update marketplace.app_users set status = 'deactivated' where id = u_a;
  perform pg_temp.never_resolves(t_a, 'user: a deactivated user resolves NULL');
  perform pg_temp.as_harness();
  update marketplace.app_users set status = 'active' where id = u_a;
  perform pg_temp.ok(pg_temp.resolved(t_a) = u_a, 'user: reactivating the user restores the same token');

  -- -------------------------------------------------------------------------
  -- 2. A valid token reads only its own tenant's rows
  -- -------------------------------------------------------------------------
  perform pg_temp.present(t_a);
  o_a := marketplace.create_organization('S21 A Hauling', 's21-a-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label) values (o_a, 'log_truck', 'S21 A probe')
  returning id into e_a;
  perform pg_temp.present(t_b);
  o_b := marketplace.create_organization('S21 B Hauling', 's21-b-hauling', 'OR', true);
  insert into marketplace.equipment_units (org_id, equipment_code, unit_label) values (o_b, 'log_truck', 'S21 B probe')
  returning id into e_b;

  perform pg_temp.ok(pg_temp.units_visible(t_a, o_a) = 1 and pg_temp.units_visible(t_a, o_b) = 0,
    'tenant: A reads its own organization''s equipment and none of B''s');
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_b) = 1 and pg_temp.units_visible(t_b, o_a) = 0,
    'tenant: B reads its own organization''s equipment and none of A''s');
  perform pg_temp.present(t_a);
  perform pg_temp.ok((select count(*) = 1 and bool_and(user_id = u_a) from marketplace.identity_links),
    'tenant: A reads exactly its own identity link');
  perform pg_temp.ok(not exists (select 1 from marketplace.organization_memberships where org_id = o_b),
    'tenant: A reads none of B''s memberships');
  perform pg_temp.ok(pg_temp.viewer_opens(t_a, o_a) and not pg_temp.viewer_opens(t_a, o_b),
    'tenant: get_viewer_marketplace_access opens A''s organization for A and refuses B''s');
  perform pg_temp.present(t_a);
  perform pg_temp.fails(format('select * from marketplace.get_viewer_marketplace_access(%L)', o_b),
    '42501', 'not available', 'tenant: ... with the generic refusal, not an existence hint');

  perform pg_temp.ok(pg_temp.units_visible(t_wrong, o_a) = 0,
    'tenant: an unresolved claim set for A (wrong audience) reads none of A''s equipment');
  perform pg_temp.present(t_wrong);
  perform pg_temp.ok(not exists (select 1 from marketplace.identity_links),
    'tenant: ... and no identity link');
  perform pg_temp.fails(format('select * from marketplace.get_viewer_marketplace_access(%L)', o_a),
    '42501', 'authentication required', 'tenant: ... and get_viewer_marketplace_access refuses it as unauthenticated');
  perform pg_temp.fails($q$select marketplace.create_organization('S21 Ghost', 's21-ghost', 'OR', true)$q$,
    '42501', 'authentication required', 'tenant: an unresolved claim set cannot create an organization');

  -- -------------------------------------------------------------------------
  -- 3. Access follows the membership on the very next statement (same claims throughout)
  -- -------------------------------------------------------------------------
  perform pg_temp.present(t_a);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_a, u_b, 'driver', false, 'invited')
  returning id into m_b;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 0 and not pg_temp.viewer_opens(t_b, o_a),
    'membership: an invitation alone opens nothing');
  perform pg_temp.present(t_b);
  update marketplace.organization_memberships set status = 'active' where id = m_b;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 1 and pg_temp.viewer_opens(t_b, o_a),
    'membership: once B accepts, B reads A''s equipment (positive control)');

  perform pg_temp.present(t_a);
  update marketplace.organization_memberships set status = 'suspended' where id = m_b;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 0 and not pg_temp.viewer_opens(t_b, o_a),
    'membership: a suspension cuts B off on the next statement');
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_b) = 1 and pg_temp.resolved(t_b) = u_b,
    'membership: ... while the same claims still resolve B and still open B''s own organization');
  perform pg_temp.present(t_a);
  update marketplace.organization_memberships set status = 'active' where id = m_b;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 1, 'membership: reinstating B restores access');

  perform pg_temp.present(t_a);
  update marketplace.organization_memberships set status = 'removed' where id = m_b;
  perform pg_temp.as_harness();
  perform pg_temp.ok((select status = 'removed' and ended_at is not null from marketplace.organization_memberships where id = m_b),
    'membership: removal is recorded with its end time');
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 0 and not pg_temp.viewer_opens(t_b, o_a),
    'membership: a removed member loses access on the next statement');
  perform pg_temp.present(t_b);
  perform pg_temp.ok(not exists (select 1 from marketplace.my_org_ids(array['owner', 'manager', 'staff', 'driver']) x where x = o_a),
    'membership: ... and A''s organization is no longer among B''s organizations');
  perform pg_temp.fails(format('update marketplace.organization_memberships set status = %L where id = %L', 'active', m_b),
    '42501', 'members may only accept an invitation or leave', 'membership: a removed member cannot reinstate themselves');
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_b) = 1, 'membership: B''s own organization is unaffected by the removal');

  perform pg_temp.present(t_a);
  insert into marketplace.organization_memberships (org_id, user_id, role, landing_workspace_seat, status)
  values (o_a, u_b, 'driver', false, 'invited')
  returning id into m_again;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 0,
    'membership: after removal, a new invitation opens nothing until B accepts it again');
  perform pg_temp.present(t_b);
  update marketplace.organization_memberships set status = 'active' where id = m_again;
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_a) = 1, 'membership: ... and B''s fresh acceptance restores access');

  perform pg_temp.as_harness();
  update marketplace.organizations set status = 'suspended' where id = o_a;
  perform pg_temp.ok(pg_temp.units_visible(t_a, o_a) = 0 and not pg_temp.viewer_opens(t_a, o_a)
    and pg_temp.units_visible(t_b, o_a) = 0,
    'organization: suspending an organization cuts off its owner and members on the next statement');
  perform pg_temp.ok(pg_temp.units_visible(t_b, o_b) = 1, 'organization: ... and leaves their other organizations alone');

  raise notice 'ALL IDENTITY-CLAIM AND MEMBERSHIP-REVOCATION (#112 DATABASE LAYER) TESTS PASSED.';
end
$$;

rollback;
