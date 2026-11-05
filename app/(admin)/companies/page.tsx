"use client"
import React, { useState } from 'react'
import CompaniesTable from '../../../components/companies/companies-table'
import CompaniesHeader from '../../../components/companies/companies-header'
import CompanyForm from '../../../components/companies/company-form'

export default function CompaniesPage() {
  const [openCreate, setOpenCreate] = useState(false)

  return (
    <main className="min-h-screen bg-gray-50 p-6 lg:p-12">
      <div className="max-w-7xl mx-auto">
        <CompaniesHeader onCreate={() => setOpenCreate(true)} />

        <div className="mt-8">
          <CompaniesTable />
        </div>
      </div>

      <CompanyForm open={openCreate} onClose={() => setOpenCreate(false)} />
    </main>
  )
}
