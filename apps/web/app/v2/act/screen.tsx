import React from "react"

import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button } from "@logloads/ui/primitives"

import { PageNotice } from "@/components/v2/PageNotice"

import styles from "./screen.module.css"
import type { OneTapModel } from "./view"

/**
 * The one-tap page (#292). The button is a POST. Nothing on this screen is a link that performs the action.
 */
export function OneTapScreen({ model, pressHref }: { model: OneTapModel; pressHref: string }) {
  return (
    <div data-ds-page="one-tap" data-one-tap={model.kind}>
      <PageHeader title={model.title} />
      <PageContainer width="narrow">
        <ContentGrid
          layout="single"
          main={
            <Section variant="surface">
              <div className={styles.stack}>
                {model.alert ? <PageNotice role="alert" tone={model.alert.tone}>{model.alert.text}</PageNotice> : null}
                {model.statement ? <p className={styles.copy}>{model.statement}</p> : null}
                {model.replyBody ? <p className={styles.copy}>{model.replyBody}</p> : null}
                {model.body ? <p className={styles.copy}>{model.body}</p> : null}
                {model.kind === "ready" && model.button && pressHref ? (
                  <form action={pressHref} method="post">
                    <input name="press" type="hidden" value="1" />
                    <Button className={styles.wide} label={model.button} size="lg" type="submit" />
                  </form>
                ) : null}
                {model.nextHref && model.nextLabel ? (
                  <Button className={styles.wide} href={model.nextHref} label={model.nextLabel} size="lg" variant="secondary" />
                ) : null}
              </div>
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}
