import { Module } from '@nestjs/common';
import { AdminCatalogController } from './admin-catalog.controller';
import {
  ServiceCategoriesController,
  ServicesController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [
    ServiceCategoriesController,
    ServicesController,
    AdminCatalogController,
  ],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
