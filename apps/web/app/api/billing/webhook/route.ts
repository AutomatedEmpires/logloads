import type { LogLoadsDatabaseState } from "@logloads/db"
import {
	applyScheduledOrganizationSubscriptionPlanChange,
	activateAuthorizedOrganizationSubscriptionFromProvider,
	bindNetworkOverageInvoiceProvider,
	bindOrganizationSubscriptionProvider,
	bindOrganizationSubscriptionScheduleProvider,
	markNetworkOverageInvoiceFailed,
	markNetworkOverageInvoicePaid,
	recordSubscriptionBaseInvoiceProviderState
} from "@logloads/services"
import { NextRequest, NextResponse } from "next/server"

import { captureServerEvent } from "@/lib/analytics"
import {
	applyBillingEvent,
	handleStripeBillingEvent,
	operatingStateAccess,
	recordBillingEvent,
	resolveStripeWebhook,
	type BillingEventResult,
	type StripeBillingEvent,
	type StripeBillingPort,
	type StripeSubscriptionFacts,
	type SubscriptionBillingEventHooks
} from "@/lib/billing"
import {
	baseInvoicePaymentCompositionProblem,
	expectedStripeLivemode,
	PILOT_TERM_DAYS,
	resolveSubscriptionStripe,
	usageInvoiceCompositionProblem,
	verifyAcceptedPrice,
	verifyExpectedStripeAccount,
	type SubscriptionStripePort
} from "@/lib/subscription-stripe"

type LocalSubscription = LogLoadsDatabaseState["organizationSubscriptions"][number]

const BASE_PRICE_ENV_BY_PLAN = {
	dispatch_pro: "STRIPE_PRICE_DISPATCH",
	network_100: "STRIPE_PRICE_NETWORK_100",
	network_25: "STRIPE_PRICE_NETWORK_25",
	network_50: "STRIPE_PRICE_NETWORK_50",
	network_pilot: "STRIPE_PRICE_NETWORK_PILOT"
} as const

const OVERAGE_PRICE_ENV_BY_PLAN = {
	network_100: "STRIPE_PRICE_NETWORK_100_OVERAGE",
	network_25: "STRIPE_PRICE_NETWORK_25_OVERAGE",
	network_50: "STRIPE_PRICE_NETWORK_50_OVERAGE",
	network_pilot: "STRIPE_PRICE_NETWORK_PILOT_OVERAGE"
} as const

function frozenOveragePriceId(
	subscription: LocalSubscription
): string | null {
	if (subscription.planCode === "enterprise_250_plus") {
		return subscription.planSnapshot.stripeOveragePriceId
	}

	const env =
		subscription.planCode in OVERAGE_PRICE_ENV_BY_PLAN
			? OVERAGE_PRICE_ENV_BY_PLAN[
					subscription.planCode as keyof typeof OVERAGE_PRICE_ENV_BY_PLAN
				]
			: null

	return env ? process.env[env]?.trim() ?? null : null
}

function result(
	event: StripeBillingEvent,
	status: BillingEventResult["status"],
	detail: string
): BillingEventResult {
	return { detail, eventId: event.id, eventType: event.type, status }
			}

function stringValue(object: Record<string, unknown>, key: string): string | null {
	const value = object[key]

	return typeof value === "string" && value.trim() ? value : null
}

function referenceValue(object: Record<string, unknown>, key: string): string | null {
	const value = object[key]

	if (typeof value === "string" && value.trim()) {
		return value
	}

	return value && typeof value === "object"
		? stringValue(value as Record<string, unknown>, "id")
		: null
}

function metadataValue(event: StripeBillingEvent, key: string): string | null {
	const metadata = event.object.metadata

	return metadata && typeof metadata === "object"
		? stringValue(metadata as Record<string, unknown>, key)
		: null
}

function safeIntegerValue(
	object: Record<string, unknown>,
	key: string
): number | null {
	const value = object[key]

	return Number.isSafeInteger(value) ? (value as number) : null
}

function optionalUnixTimestamp(
	object: Record<string, unknown>,
	key: string
): string | null {
	const value = safeIntegerValue(object, key)

	return value !== null && value > 0
		? new Date(value * 1000).toISOString()
		: null
}

const BASE_INVOICE_STATUSES = new Set([
	"draft",
	"open",
	"paid",
	"void",
	"uncollectible"
])

function baseInvoiceProviderFacts(
	event: StripeBillingEvent,
	outcome: "failed" | "succeeded"
): {
	ok: true
	value: Omit<
		Parameters<typeof recordSubscriptionBaseInvoiceProviderState>[1],
		"subscriptionId"
	>
} | { ok: false; problem: string } {
	const providerInvoiceId = stringValue(event.object, "id")
	const amountDueCents = safeIntegerValue(event.object, "amount_due")
	const amountPaidCents = safeIntegerValue(event.object, "amount_paid")
	const amountRemainingCents = safeIntegerValue(event.object, "amount_remaining")
	const providerSignedTotalCents = safeIntegerValue(event.object, "total")
	const providerStartingBalanceCents = safeIntegerValue(
		event.object,
		"starting_balance"
	)
	const providerEndingBalanceCents = safeIntegerValue(
		event.object,
		"ending_balance"
	)
	const attemptCount = safeIntegerValue(event.object, "attempt_count")
	const currency = stringValue(event.object, "currency")
	const status = stringValue(event.object, "status")
	const hostedInvoiceUrl = stringValue(event.object, "hosted_invoice_url")
	const statusTransitions =
		event.object.status_transitions &&
		typeof event.object.status_transitions === "object"
			? (event.object.status_transitions as Record<string, unknown>)
			: {}
	const paidAt =
		optionalUnixTimestamp(statusTransitions, "paid_at") ??
		(outcome === "succeeded"
			? new Date(event.createdAt * 1000).toISOString()
			: null)

	if (!providerInvoiceId?.startsWith("in_")) {
		return { ok: false, problem: "Stripe base invoice names no provider invoice id" }
	}

	if (
		amountDueCents === null ||
		amountDueCents < 0 ||
		amountPaidCents === null ||
		amountPaidCents < 0 ||
		amountRemainingCents === null ||
		amountRemainingCents < 0 ||
		amountPaidCents + amountRemainingCents !== amountDueCents ||
		providerSignedTotalCents === null ||
		providerStartingBalanceCents === null ||
		providerEndingBalanceCents === null ||
		providerStartingBalanceCents !== 0 ||
		providerEndingBalanceCents !== 0 ||
		providerSignedTotalCents !== amountDueCents
	) {
		return {
			ok: false,
			problem: "Stripe base invoice has invalid due or remaining amounts"
		}
	}

	if (attemptCount === null || attemptCount < 0) {
		return { ok: false, problem: "Stripe base invoice has no valid attempt count" }
	}

	if (!currency || !BASE_INVOICE_STATUSES.has(status ?? "")) {
		return { ok: false, problem: "Stripe base invoice has no canonical status or currency" }
	}

	if (
		outcome === "succeeded" &&
		(status !== "paid" || amountRemainingCents !== 0)
	) {
		return {
			ok: false,
			problem: "Stripe reported a successful base payment without a paid zero balance"
		}
	}

	if (outcome === "failed" && status === "paid") {
		return {
			ok: false,
			problem: "Stripe reported a failed base payment on a paid invoice"
		}
	}

	return {
		ok: true,
		value: {
			amountDueCents,
			amountPaidCents,
			amountRemainingCents,
			attemptCount,
			attemptedAt:
				attemptCount > 0
					? new Date(event.createdAt * 1000).toISOString()
					: null,
			currency,
			dueAt: optionalUnixTimestamp(event.object, "due_date"),
			hostedInvoiceUrl,
			lastPaymentFailure:
				outcome === "failed"
					? `Stripe reported ${event.type} for ${providerInvoiceId}`
					: null,
			nextPaymentAttemptAt: optionalUnixTimestamp(
				event.object,
				"next_payment_attempt"
			),
			paidAt,
			providerInvoiceId,
			status: status as "draft" | "open" | "paid" | "void" | "uncollectible"
		}
	}
}

function overageInvoiceProviderFacts(
	event: StripeBillingEvent
): {
	ok: true
	value: Omit<
		Parameters<typeof bindNetworkOverageInvoiceProvider>[1],
		"invoiceId"
	>
} | { ok: false; problem: string } {
	const stripeInvoiceId = stringValue(event.object, "id")
	const providerTotalCents = safeIntegerValue(event.object, "total")
	const providerAmountDueCents = safeIntegerValue(event.object, "amount_due")
	const providerAmountPaidCents = safeIntegerValue(event.object, "amount_paid")
	const providerAmountRemainingCents = safeIntegerValue(
		event.object,
		"amount_remaining"
	)
	const providerStartingBalanceCents = safeIntegerValue(
		event.object,
		"starting_balance"
	)
	const providerEndingBalanceCents = safeIntegerValue(
		event.object,
		"ending_balance"
	)

	if (!stripeInvoiceId?.startsWith("in_")) {
		return {
			ok: false,
			problem: "Stripe overage invoice names no provider invoice id"
		}
	}

	if (
		providerTotalCents === null ||
		providerAmountDueCents === null ||
		providerAmountDueCents < 0 ||
		providerAmountPaidCents === null ||
		providerAmountPaidCents < 0 ||
		providerAmountRemainingCents === null ||
		providerAmountRemainingCents < 0 ||
		providerStartingBalanceCents === null ||
		providerEndingBalanceCents === null ||
		providerStartingBalanceCents !== 0 ||
		providerEndingBalanceCents !== 0 ||
		providerAmountPaidCents + providerAmountRemainingCents !==
			providerAmountDueCents ||
		providerTotalCents !== providerAmountDueCents
	) {
		return {
			ok: false,
			problem:
				"Stripe overage invoice settlement facts do not reconcile to its signed total"
		}
	}

	return {
		ok: true,
		value: {
			providerAmountDueCents,
			providerAmountPaidCents,
			providerAmountRemainingCents,
			stripeInvoiceId
		}
	}
}

function subscriptionTransition(
	status: string,
	eventType: string
): {
	graceState: LocalSubscription["graceState"]
	paymentState: LocalSubscription["paymentState"]
	status: LocalSubscription["status"]
} | null {
	if (eventType === "customer.subscription.deleted" || status === "canceled") {
		return { graceState: "expired", paymentState: "none", status: "cancelled" }
	}

	switch (status) {
		case "active":
			return { graceState: "none", paymentState: "current", status: "active" }
		case "incomplete":
			return {
				graceState: "active",
				paymentState: "requires_payment_method",
				status: "incomplete"
			}
		case "incomplete_expired":
			return {
				graceState: "expired",
				paymentState: "uncollectible",
				status: "expired"
			}
		case "past_due":
			return { graceState: "active", paymentState: "past_due", status: "past_due" }
		case "paused":
			return { graceState: "active", paymentState: "failed", status: "past_due" }
		case "unpaid":
			return {
				graceState: "expired",
				paymentState: "uncollectible",
				status: "past_due"
			}
		// Network subscriptions have no free trial. Receiving this provider state
		// is a catalog/configuration error, not paid access.
		case "trialing":
		default:
			return null
	}
}

function localSubscription(
	state: LogLoadsDatabaseState,
	input: { localId?: string | null; stripeSubscriptionId?: string | null }
): LocalSubscription | null {
	const matches = state.organizationSubscriptions.filter(
		(candidate) =>
			(Boolean(input.localId) && candidate.id === input.localId) ||
			(Boolean(input.stripeSubscriptionId) &&
				candidate.stripeSubscriptionId === input.stripeSubscriptionId)
	)

	if (matches.length > 1) {
		throw new Error("A Stripe subscription resolves to multiple canonical subscriptions")
	}

	return matches[0] ?? null
}

interface SubscriptionProviderMatch {
	pending: boolean
	planCode: LocalSubscription["planCode"]
	planSnapshot: LocalSubscription["planSnapshot"]
}

type SubscriptionProviderResolution =
	| { match: SubscriptionProviderMatch; problem: null }
	| { match: null; problem: string }

function acceptedBasePriceId(
	planCode: LocalSubscription["planCode"],
	planSnapshot: LocalSubscription["planSnapshot"]
): string | null {
	const priceEnv =
		planCode in BASE_PRICE_ENV_BY_PLAN
			? BASE_PRICE_ENV_BY_PLAN[planCode as keyof typeof BASE_PRICE_ENV_BY_PLAN]
			: null

	return planCode === "enterprise_250_plus"
		? planSnapshot.stripePriceId
		: priceEnv
			? process.env[priceEnv]?.trim() ?? null
			: null
}

function subscriptionProviderResolution(
	subscription: LocalSubscription,
	facts: StripeSubscriptionFacts
): SubscriptionProviderResolution {
	const expectedLiveMode = expectedStripeLivemode(process.env)

	if (!facts.currentPeriodStartsAt || !facts.currentPeriodEndsAt) {
		return { match: null, problem: "Stripe subscription has no single aligned billing period" }
	}

	if (!facts.stripeCustomerId) {
		return { match: null, problem: "Stripe subscription has no customer" }
	}

	if (
		subscription.stripeCustomerId &&
		subscription.stripeCustomerId !== facts.stripeCustomerId
	) {
		return {
			match: null,
			problem: "Stripe subscription customer does not match its canonical binding"
		}
	}

	if (facts.metadata?.organizationSubscriptionId !== subscription.id) {
		return {
			match: null,
			problem: "Stripe subscription metadata does not match the canonical subscription"
		}
	}

	if (facts.metadata.organizationId !== subscription.organizationId) {
		return {
			match: null,
			problem: "Stripe subscription metadata does not match the canonical organization"
		}
	}

	if (
		subscription.stripeScheduleId &&
		facts.scheduleId &&
		facts.scheduleId !== subscription.stripeScheduleId
	) {
		return {
			match: null,
			problem: "Stripe subscription schedule does not match its canonical binding"
		}
	}

	if (facts.livemode !== expectedLiveMode) {
		return {
			match: null,
			problem: "Stripe subscription mode does not match the configured secret key"
		}
	}

	let match: SubscriptionProviderMatch | null = null

	if (facts.metadata.planCode === subscription.planCode) {
		match = {
			pending: false,
			planCode: subscription.planCode,
			planSnapshot: subscription.planSnapshot
		}
	} else if (
		subscription.pendingPlanCode &&
		subscription.pendingPlanEffectiveAt &&
		subscription.pendingPlanSnapshot &&
		facts.metadata.planCode === subscription.pendingPlanCode
	) {
		if (
			Date.parse(facts.currentPeriodStartsAt) <
			Date.parse(subscription.pendingPlanEffectiveAt)
		) {
			return {
				match: null,
				problem: "Stripe changed the subscription before the canonical effective time"
			}
		}

		match = {
			pending: true,
			planCode: subscription.pendingPlanCode,
			planSnapshot: subscription.pendingPlanSnapshot
		}
	}

	if (!match) {
		return {
			match: null,
			problem: "Stripe subscription metadata does not match the accepted or pending plan"
		}
	}

	const expectedPriceId = acceptedBasePriceId(match.planCode, match.planSnapshot)

	if (!expectedPriceId?.startsWith("price_")) {
		return {
			match: null,
			problem: `The accepted ${match.planCode} provider Price is not configured`
		}
	}

	if (facts.priceId !== expectedPriceId) {
		return {
			match: null,
			problem: "Stripe subscription price does not match the accepted plan"
		}
	}

	if (facts.metadata.billingModel !== match.planSnapshot.billingModel) {
		return {
			match: null,
			problem: "Stripe subscription metadata does not match the accepted billing model"
		}
	}

	if (
		(facts.metadata.internal_billing_test === "true") !==
		match.planSnapshot.internalBillingTest
	) {
		return {
			match: null,
			problem: "Stripe internal-test metadata does not match the canonical subscription"
		}
	}

	return { match, problem: null }
}

function captureBillingEvent(
	name: string,
	subscription: Pick<
		LocalSubscription,
		"billingModel" | "internalBillingTest" | "organizationId" | "planCode"
	>,
	properties: Record<string, unknown> = {}
): void {
	captureServerEvent(name, `organization:${subscription.organizationId}`, {
		billingModel: subscription.billingModel,
		internalBillingTest: subscription.internalBillingTest,
		organizationId: subscription.organizationId,
		planCode: subscription.planCode,
		...properties
	})
}

function pendingFirstPaymentTransition(
	subscription: LocalSubscription,
	transition: ReturnType<typeof subscriptionTransition>
) {
	if (
		transition &&
		!subscription.operationalActivatedAt &&
		transition.paymentState === "current"
	) {
		return {
			graceState: "none" as const,
			paymentState: "none" as const,
			status: "pending" as const
		}
	}

	return transition
}

function createSubscriptionEventHooks(input: {
	port: StripeBillingPort
	state: ReturnType<typeof operatingStateAccess>
	subscriptionPort: SubscriptionStripePort | null
}): SubscriptionBillingEventHooks {
	const deps = { port: input.port, state: input.state }

	return {
		async checkoutCompleted({ event, subscription: facts }) {
			const localId =
				metadataValue(event, "organizationSubscriptionId") ??
				facts.metadata?.organizationSubscriptionId ??
				null
			const canonical = await input.state.read((state) =>
				localSubscription(state, {
					localId,
					stripeSubscriptionId: facts.id
				})
			)

			if (!canonical) {
				return result(event, "unresolved", "Network checkout names no canonical subscription")
			}

			const provider = subscriptionProviderResolution(canonical, facts)
			const transition = pendingFirstPaymentTransition(
				canonical,
				subscriptionTransition(facts.status, event.type)
			)

			if (provider.problem || provider.match?.pending || !transition) {
				return result(
					event,
					"unresolved",
					provider.problem ??
						(provider.match?.pending
							? "A new checkout cannot skip directly to a pending future plan"
							: `Network checkout cannot activate Stripe status ${facts.status}`)
				)
			}

			let newlyBound = false
			const applied = await applyBillingEvent(deps, event, (draft, at) => {
				const current = localSubscription(draft.state, { localId: canonical.id })

				if (!current) {
					return result(event, "unresolved", "Network checkout subscription disappeared")
				}

				const bound = bindOrganizationSubscriptionProvider(
					draft.state,
					{
						currentPeriodEnd: facts.currentPeriodEndsAt!,
						currentPeriodStart: facts.currentPeriodStartsAt!,
						paymentState: transition.paymentState,
						status: transition.status,
						stripeCustomerId: facts.stripeCustomerId!,
						stripeSubscriptionId: facts.id,
						subscriptionId: current.id
					},
					at
				)

				newlyBound = !current.stripeSubscriptionId && bound.changed
				recordBillingEvent(draft.state, {
					action: "organization_subscription_checkout_completed",
					at,
					entityId: current.id,
					entityType: "organization_subscription",
					event,
					metadata: {
						internalBillingTest: current.internalBillingTest,
						organizationId: current.organizationId,
						planCode: current.planCode
					}
				})

				return result(event, "applied", "Network subscription checkout reconciled")
			})

			if (applied.status === "applied" && newlyBound) {
				captureBillingEvent("subscription_started", canonical)
			}

			return applied
		},

		async subscriptionChanged({ event, subscription: facts }) {
			const canonical = await input.state.read((state) =>
				localSubscription(state, {
					localId: facts.metadata?.organizationSubscriptionId,
					stripeSubscriptionId: facts.id
				})
			)

			if (!canonical) {
				return result(
					event,
					"unresolved",
					`No canonical subscription is linked to ${facts.id}`
				)
			}

			const provider = subscriptionProviderResolution(canonical, facts)
			const transition = pendingFirstPaymentTransition(
				canonical,
				subscriptionTransition(facts.status, event.type)
			)

			if (provider.problem || !provider.match || !transition) {
				return result(
					event,
					"unresolved",
					provider.problem ??
						`Network subscription cannot apply Stripe status ${facts.status}`
				)
			}

			let newlyBound = false
			let historicalIgnored = false
			const applied = await applyBillingEvent(deps, event, (draft, at) => {
				let current = localSubscription(draft.state, { localId: canonical.id })

				if (!current) {
					return result(event, "unresolved", "Canonical subscription disappeared")
				}

				if (provider.match.pending) {
					current = applyScheduledOrganizationSubscriptionPlanChange(
						draft.state,
						{
							currentPeriodEnd: facts.currentPeriodEndsAt!,
							currentPeriodStart: facts.currentPeriodStartsAt!,
							expectedPlanCode: provider.match.planCode,
							subscriptionId: current.id
						},
						at
					).subscription
				}

				const bound = bindOrganizationSubscriptionProvider(
					draft.state,
					{
						currentPeriodEnd: facts.currentPeriodEndsAt!,
						currentPeriodStart: facts.currentPeriodStartsAt!,
						paymentState: transition.paymentState,
						...(transition.status === "cancelled"
							? {
									providerEffectiveAt: new Date(
										event.createdAt * 1000
									).toISOString()
								}
							: {}),
						status:
							current.status === "non_renewing" && transition.status === "active"
								? "non_renewing"
								: transition.status,
						stripeCustomerId: facts.stripeCustomerId!,
						stripeSubscriptionId: facts.id,
						subscriptionId: current.id
					},
					at
				)

				newlyBound = !current.stripeSubscriptionId && bound.changed
				historicalIgnored =
					bound.outcome === "historical_ignored"
				recordBillingEvent(draft.state, {
					action: historicalIgnored
						? "historical_subscription_provider_event_ignored"
						: "organization_subscription_provider_updated",
					at,
					entityId: current.id,
					entityType: "organization_subscription",
					event,
					metadata: {
						internalBillingTest: current.internalBillingTest,
						organizationId: current.organizationId,
						paymentState: transition.paymentState,
						planCode: current.planCode,
						status: transition.status
					}
				})

				return result(
					event,
					"applied",
					historicalIgnored
						? "Historical subscription lifecycle ignored"
						: "Network subscription lifecycle reconciled"
				)
			})

			if (applied.status === "applied" && !historicalIgnored) {
				if (newlyBound) {
					captureBillingEvent("subscription_started", canonical)
				}
				if (transition.status === "cancelled" || transition.status === "expired") {
					captureBillingEvent("subscription_canceled", canonical)
				} else if (transition.paymentState !== "current") {
					captureBillingEvent("subscription_payment_past_due", canonical, {
						paymentState: transition.paymentState
					})
				}
			}

			return applied
		},

		async invoicePayment({ classification, event, outcome, subscription: facts }) {
			if (classification.kind === "internal_smoke") {
				const runId = classification.billingSmokeRunId

				if (!runId) {
					return result(event, "unresolved", "Internal smoke invoice names no run")
				}

				const applied = await applyBillingEvent(deps, event, (draft, at) => {
					recordBillingEvent(draft.state, {
						action:
							outcome === "succeeded"
								? "internal_billing_smoke_payment_succeeded"
								: "internal_billing_smoke_payment_failed",
						at,
						entityId: runId,
						entityType: "billing_smoke_run",
						event,
						metadata: { internalBillingTest: true }
					})

					return result(event, "applied", "Internal billing verification payment recorded")
				})

				if (applied.status === "applied") {
					captureServerEvent(
						outcome === "succeeded"
							? "billing_internal_smoke_paid"
							: "billing_internal_smoke_failed",
						"internal-billing-smoke",
						{ internalBillingTest: true, revenueExcluded: true }
					)
				}

				return applied
			}

			if (classification.kind === "subscription_overage") {
				const invoiceId = classification.networkOverageInvoiceId

				if (!invoiceId) {
					return result(event, "unresolved", "Overage invoice names no canonical invoice")
				}

				const providerFacts = overageInvoiceProviderFacts(event)
				const providerInvoiceId = providerFacts.ok
					? providerFacts.value.stripeInvoiceId
					: stringValue(event.object, "id")
				const customerId = referenceValue(event.object, "customer")
				const currency = stringValue(event.object, "currency")
				const resolved = await input.state.read((state) => {
					const invoice = state.networkOverageInvoices.find(
						(candidate) => candidate.id === invoiceId
					)
					const summary = invoice
						? state.billingPeriodSummaries.find(
								(candidate) => candidate.id === invoice.billingPeriodSummaryId
							)
						: null
					const subscription = summary
						? localSubscription(state, { localId: summary.subscriptionId })
						: null
					const adjustments = invoice
						? invoice.adjustmentIds.map((adjustmentId) =>
								state.billingAdjustments.find(
									(candidate) =>
										candidate.id === adjustmentId &&
										candidate.invoiceId === invoice.id &&
										candidate.settlementIntent === "invoice_line_item"
								)
							)
						: []

					return {
						adjustments,
						invoice: invoice ?? null,
						scopeValid: Boolean(
							invoice &&
								summary &&
								subscription &&
								invoice.organizationId === summary.organizationId &&
								summary.organizationId === subscription.organizationId
						),
						subscription
					}
				})

				if (
					!resolved.invoice ||
					!resolved.subscription ||
					!resolved.scopeValid ||
					resolved.adjustments.some((adjustment) => !adjustment) ||
					!providerFacts.ok
				) {
					return result(
						event,
						"unresolved",
						providerFacts.ok
							? "Overage invoice has no canonical ledger target"
							: providerFacts.problem
					)
				}

				if (
					!providerInvoiceId ||
					!resolved.subscription.stripeCustomerId ||
					customerId !== resolved.subscription.stripeCustomerId ||
					currency?.toUpperCase() !== "USD" ||
					safeIntegerValue(event.object, "total") !==
						resolved.invoice.amountDueCents
				) {
					return result(
						event,
						"unresolved",
						"Stripe overage invoice facts do not match the frozen canonical invoice"
					)
				}

				if (
					resolved.invoice.stripeInvoiceId &&
					resolved.invoice.stripeInvoiceId !== providerInvoiceId
				) {
					return result(
						event,
						"unresolved",
						"Stripe overage invoice does not match the canonical provider binding"
					)
				}

				if (!resolved.invoice.stripeInvoiceId) {
					const priceId = frozenOveragePriceId(resolved.subscription)

					if (!input.subscriptionPort || !priceId?.startsWith("price_")) {
						return result(
							event,
							"unresolved",
							"Overage invoice composition cannot be verified against its accepted Price"
						)
					}

					await verifyAcceptedPrice(input.subscriptionPort, {
						livemode:
							expectedStripeLivemode(process.env),
						organizationId: resolved.subscription.organizationId,
						plan: resolved.subscription.planSnapshot,
						priceId,
						role: "overage",
						subscriptionId: resolved.subscription.id
					})
					const providerInvoice =
						await input.subscriptionPort.retrieveInvoice(
							providerInvoiceId
						)
					const compositionProblem =
						providerInvoice.id !== providerInvoiceId ||
						providerInvoice.metadata.networkOverageInvoiceId !==
							resolved.invoice.id ||
						providerInvoice.metadata.billingPeriodSummaryId !==
							resolved.invoice.billingPeriodSummaryId
							|| providerInvoice.totalCents !==
								resolved.invoice.amountDueCents
							|| providerInvoice.amountDueCents !==
								providerFacts.value.providerAmountDueCents
							|| providerInvoice.amountPaidCents !==
								providerFacts.value.providerAmountPaidCents
							|| providerInvoice.amountRemainingCents !==
								providerFacts.value.providerAmountRemainingCents
							? "Stripe invoice metadata does not match the frozen overage ledger"
							: usageInvoiceCompositionProblem(providerInvoice, {
									adjustments: resolved.adjustments.map(
										(adjustment) => ({
											adjustmentId: adjustment!.id,
											amountDeltaCents:
												adjustment!.amountDeltaCents,
											reason: adjustment!.reason,
											type: adjustment!.type
										})
									),
									complete: true,
									customerId:
										resolved.subscription.stripeCustomerId!,
									expectedTotalCents:
										resolved.invoice.amountDueCents,
									priceId,
									quantity: resolved.invoice.quantity,
									unitAmountCents:
										resolved.invoice.unitAmountCents
								})

					if (compositionProblem) {
						return result(event, "unresolved", compositionProblem)
					}
				}

				const applied = await applyBillingEvent(deps, event, (draft, at) => {
					bindNetworkOverageInvoiceProvider(
						draft.state,
						{ invoiceId, ...providerFacts.value },
						at
					)

					if (outcome === "succeeded") {
						markNetworkOverageInvoicePaid(
							draft.state,
							{
								invoiceId,
								providerFacts: providerFacts.value
							},
							at
						)
					} else {
						markNetworkOverageInvoiceFailed(
							draft.state,
							{
								invoiceId,
								providerFacts: providerFacts.value,
								reason: `Stripe reported ${event.type} for ${providerInvoiceId}`
							},
							at
						)
					}

					recordBillingEvent(draft.state, {
						action:
							outcome === "succeeded"
								? "network_overage_invoice_provider_paid"
								: "network_overage_invoice_provider_failed",
						at,
						entityId: invoiceId,
						entityType: "network_overage_invoice",
						event,
						metadata: {
							billingPeriodSummaryId: resolved.invoice!.billingPeriodSummaryId,
							internalBillingTest: resolved.invoice!.internalBillingTest,
							organizationId: resolved.invoice!.organizationId
						}
					})

					return result(event, "applied", `Network overage payment ${outcome}`)
				})

				if (applied.status === "applied") {
					captureBillingEvent(
						outcome === "succeeded"
							? "subscription_overage_paid"
							: "subscription_overage_failed",
						resolved.subscription,
						{
							amountCents:
								providerFacts.value.providerAmountPaidCents,
							quantity: resolved.invoice.quantity
						}
					)
				}

				return applied
			}

			if (classification.kind !== "subscription_base" || !facts) {
				return result(event, "unresolved", "Base subscription invoice has no subscription")
			}

			const canonical = await input.state.read((state) =>
				localSubscription(state, {
					localId: classification.organizationSubscriptionId,
					stripeSubscriptionId: facts.id
				})
			)

			if (!canonical) {
				return result(event, "unresolved", "Base invoice has no canonical subscription")
			}

			const provider = subscriptionProviderResolution(canonical, facts)
			const customerId = referenceValue(event.object, "customer")
			const currency = stringValue(event.object, "currency")
			const invoiceFacts = baseInvoiceProviderFacts(event, outcome)

			if (
				provider.problem ||
				!provider.match ||
				!invoiceFacts.ok ||
				customerId !== facts.stripeCustomerId ||
				currency?.toUpperCase() !== "USD"
			) {
				return result(
					event,
					"unresolved",
					provider.problem ??
						(invoiceFacts.ok
							? "Stripe base invoice facts do not match the accepted subscription"
					: invoiceFacts.problem)
				)
			}

			const firstPaidActivation =
				outcome === "succeeded" && !canonical.operationalActivatedAt
			const exactPaidBaseInvoice = outcome === "succeeded"
			let pilotSchedule: Awaited<
				ReturnType<SubscriptionStripePort["ensureFinitePilotSchedule"]>
			> | null = null

			if (firstPaidActivation) {
				if (!canonical.activationAuthorizedAt) {
					return result(
						event,
						"unresolved",
						"The canonical subscription has not been explicitly authorized for activation"
					)
				}

				if (provider.match.pending) {
					return result(
						event,
						"unresolved",
						"A first paid activation cannot skip directly to a pending future plan"
					)
				}
			}

			if (exactPaidBaseInvoice) {
				const subscriptionPort = input.subscriptionPort

				if (!subscriptionPort) {
					return result(
						event,
						"unresolved",
						"Stripe subscription billing is unavailable for a successful base payment"
					)
				}

				await verifyAcceptedPrice(subscriptionPort, {
					livemode:
						expectedStripeLivemode(process.env),
					organizationId: canonical.organizationId,
					plan: provider.match.planSnapshot,
					priceId: facts.priceId!,
					role: "base",
					subscriptionId: canonical.id
				})
				const providerInvoice =
					await subscriptionPort.retrieveInvoice(
						invoiceFacts.value.providerInvoiceId
					)
				const compositionProblem =
					baseInvoicePaymentCompositionProblem(providerInvoice, {
						amountDueCents: invoiceFacts.value.amountDueCents,
						amountPaidCents: invoiceFacts.value.amountPaidCents,
						amountRemainingCents:
							invoiceFacts.value.amountRemainingCents,
						customerId: facts.stripeCustomerId!,
						expectedBaseCents:
							provider.match.planSnapshot.baseMonthlyPriceCents,
						expectedLivemode:
							expectedStripeLivemode(process.env),
						invoiceId: invoiceFacts.value.providerInvoiceId,
						priceId: facts.priceId!,
						stripeSubscriptionId: facts.id
					})

				if (compositionProblem) {
					return result(event, "unresolved", compositionProblem)
				}

				if (
					firstPaidActivation &&
					canonical.planCode === "network_pilot"
				) {
					const commitmentStart = facts.currentPeriodStartsAt!
					const commitmentEnd = new Date(
						Date.parse(commitmentStart) +
							PILOT_TERM_DAYS * 24 * 60 * 60 * 1000
					).toISOString()

					pilotSchedule =
						await subscriptionPort.ensureFinitePilotSchedule({
							commitmentEnd,
							commitmentStart,
							idempotencyKey: `logloads:subscription:${canonical.id}:pilot-term`,
							metadata: {
								billingModel: canonical.billingModel,
								internal_billing_test: "false",
								organizationId: canonical.organizationId,
								organizationSubscriptionId: canonical.id,
								planCode: canonical.planCode
							},
							priceId: facts.priceId!,
							subscriptionId: facts.id
						})
				}
			}

			const transition =
				outcome === "succeeded"
					? { graceState: "none", paymentState: "current", status: "active" } as const
					: { graceState: "active", paymentState: "past_due", status: "past_due" } as const
			const applied = await applyBillingEvent(deps, event, (draft, at) => {
				let current = localSubscription(draft.state, { localId: canonical.id })

				if (!current) {
					return result(event, "unresolved", "Canonical subscription disappeared")
				}

				if (provider.match.pending) {
					current = applyScheduledOrganizationSubscriptionPlanChange(
						draft.state,
						{
							currentPeriodEnd: facts.currentPeriodEndsAt!,
							currentPeriodStart: facts.currentPeriodStartsAt!,
							expectedPlanCode: provider.match.planCode,
							subscriptionId: current.id
						},
						at
					).subscription
				}

				if (firstPaidActivation) {
					current = activateAuthorizedOrganizationSubscriptionFromProvider(
						draft.state,
						{
							currentPeriodEnd: facts.currentPeriodEndsAt!,
							currentPeriodStart: facts.currentPeriodStartsAt!,
							providerInvoiceId: invoiceFacts.value.providerInvoiceId,
							stripeCustomerId: facts.stripeCustomerId!,
							stripeSubscriptionId: facts.id,
							subscriptionId: current.id
						},
						at
					).subscription

					if (pilotSchedule) {
						current = bindOrganizationSubscriptionScheduleProvider(
							draft.state,
							{
								stripeScheduleId: pilotSchedule.scheduleId,
								subscriptionId: current.id
							},
							at
						).subscription
					}
				} else {
					bindOrganizationSubscriptionProvider(
						draft.state,
						{
							currentPeriodEnd: facts.currentPeriodEndsAt!,
							currentPeriodStart: facts.currentPeriodStartsAt!,
							paymentState: transition.paymentState,
							status:
								current.status === "non_renewing" && outcome === "succeeded"
									? "non_renewing"
									: transition.status,
							stripeCustomerId: facts.stripeCustomerId!,
							stripeSubscriptionId: facts.id,
							subscriptionId: current.id
						},
						at
					)
				}
				recordSubscriptionBaseInvoiceProviderState(
					draft.state,
					{
						...invoiceFacts.value,
						subscriptionId: current.id
					},
					at
				)
				recordBillingEvent(draft.state, {
					action:
						outcome === "succeeded"
							? "organization_subscription_base_paid"
							: "organization_subscription_base_failed",
					at,
					entityId: current.id,
					entityType: "organization_subscription",
					event,
					metadata: {
						internalBillingTest: current.internalBillingTest,
						organizationId: current.organizationId,
						planCode: current.planCode
					}
				})

				return result(event, "applied", `Subscription base payment ${outcome}`)
			})

			if (applied.status === "applied") {
				captureBillingEvent(
					outcome === "succeeded"
						? "subscription_base_paid"
						: "subscription_base_failed",
					canonical,
					{
						amountDueCents: invoiceFacts.value.amountDueCents,
						amountRemainingCents: invoiceFacts.value.amountRemainingCents,
						providerInvoiceId: invoiceFacts.value.providerInvoiceId
					}
				)
				if (
					firstPaidActivation &&
					canonical.planCode === "network_pilot"
				) {
					captureBillingEvent("network_pilot_started", canonical, {
						commitmentEnd: new Date(
							Date.parse(facts.currentPeriodStartsAt!) +
								PILOT_TERM_DAYS * 24 * 60 * 60 * 1000
						).toISOString(),
						commitmentStart: facts.currentPeriodStartsAt!,
						providerInvoiceId:
							invoiceFacts.value.providerInvoiceId
					})
				}
			}

			return applied
		},

		async internalRefund({ classification, event }) {
			const runId = classification.billingSmokeRunId

			if (!runId) {
				return result(event, "unresolved", "Internal smoke refund names no run")
			}

			const applied = await applyBillingEvent(deps, event, (draft, at) => {
				recordBillingEvent(draft.state, {
					action: "internal_billing_smoke_refund_webhook",
					at,
					entityId: runId,
					entityType: "billing_smoke_run",
					event,
					metadata: { internalBillingTest: true }
				})

				return result(event, "applied", "Internal billing verification refund recorded")
			})

			if (applied.status === "applied") {
				captureServerEvent(
					"billing_internal_smoke_refunded",
					"internal-billing-smoke",
					{ internalBillingTest: true, revenueExcluded: true }
				)
			}

			return applied
		}
	}
}

/**
 * Stripe billing truth. Dispatch Pro and Network subscription lifecycle,
 * completed-Network overage invoices, owner-only internal verification, and
 * preserved legacy host invoices arrive here. No carrier or driver
 * transportation compensation passes through LogLoads.
 *
 * WHAT THE STATUS CODE MEANS TO STRIPE. A 2xx tells Stripe the event is finished
 * and it will never be sent again; anything else is retried for about three days.
 * So the answer is not a formality:
 *
 *   200  applied, already applied, or an event LogLoads genuinely does not act on
 *   400  no signature, or a signature that does not verify
 *   500  an event LogLoads should have applied and could not
 *   503  Stripe is not configured for this environment
 *
 * The previous version answered 200 for unrecognised events AND for events about
 * subscriptions it could not find, which permanently discarded them. A missing
 * target is now a 5xx: the retries are the only thing that gets a money event
 * looked at again.
 */
export async function POST(request: NextRequest) {
	const webhook = resolveStripeWebhook(process.env)

	if (!webhook.ok) {
		return NextResponse.json({ error: webhook.message }, { status: 503 })
	}

	const signature = request.headers.get("stripe-signature")

	if (!signature) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 })
	}

	let event: StripeBillingEvent

	try {
		event = webhook.value.constructWebhookEvent(await request.text(), signature)
	} catch {
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
	}

	if (event.livemode !== expectedStripeLivemode(process.env)) {
		return NextResponse.json(
			{ error: "Stripe event provider mode mismatch" },
			{ status: 400 }
		)
	}

	try {
		const subscriptionStripe = resolveSubscriptionStripe(process.env)

		if (!subscriptionStripe.ok) {
			return NextResponse.json(
				{ error: "Stripe subscription billing is not configured" },
				{ status: 503 }
			)
		}

		try {
			await verifyExpectedStripeAccount(subscriptionStripe.port, process.env)
		} catch {
			console.error(
				"LogLoads Stripe webhook account isolation verification failed"
			)

			return NextResponse.json(
				{ error: "Stripe billing account verification failed" },
				{ status: 503 }
			)
		}
		const subscriptionPort = subscriptionStripe.port
		const state = operatingStateAccess()
		const result = await handleStripeBillingEvent(event, {
			port: webhook.value,
			state,
			subscriptionEvents: createSubscriptionEventHooks({
				port: webhook.value,
				state,
				subscriptionPort
			})
		})

		if (result.status === "unresolved") {
			// The operator needs the detail. Stripe gets a retry, and the client-facing
			// body says nothing about which record could not be found.
			console.error("logloads: billing webhook could not be applied", {
				detail: result.detail,
				eventId: result.eventId,
				eventType: result.eventType
			})

			return NextResponse.json({ error: "Webhook handling failed", received: false }, { status: 500 })
		}

		return NextResponse.json({ handled: result.status, received: true })
	} catch (error) {
		console.error("logloads: billing webhook error", error)

		return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 })
	}
}
