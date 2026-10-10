-- CreateTable
CREATE TABLE "merchant_documents" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_documents_merchant_id_type_idx" ON "merchant_documents"("merchant_id", "type");

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
